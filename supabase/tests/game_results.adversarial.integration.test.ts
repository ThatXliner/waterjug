import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../src/lib/supabase';
import { defaultRD, getNewRating, type Player } from '../../src/lib/glicko';

type Actor = 'reporter' | 'opponent' | 'outsider';
type Decision = 'confirm' | 'dispute' | 'invalid';
type Command = { actor: Actor; decision: Decision };
type ResultStatus = 'pending' | 'confirmed' | 'disputed';

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
	throw new Error('Local Supabase environment variables are required for database tests');
}

const clientOptions = {
	auth: { autoRefreshToken: false, persistSession: false }
};
const admin = createClient<Database>(supabaseUrl, serviceRoleKey, clientOptions);
const clients = {} as Record<Actor, SupabaseClient<Database>>;
const userIds = {} as Record<Actor, string>;
const createdUserIds: string[] = [];
const runId = randomUUID();
let gameId: number;

function expectNoError(error: { message: string } | null, context: string) {
	expect(error, context).toBeNull();
}

async function createActor(actor: Actor) {
	const email = `peer-check-${runId}-${actor}@example.test`;
	const password = `Peer-check-${runId}!`;
	const { data, error } = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true
	});
	expectNoError(error, `create ${actor}`);
	if (!data.user) throw new Error(`No user returned for ${actor}`);

	userIds[actor] = data.user.id;
	createdUserIds.push(data.user.id);

	const client = createClient<Database>(supabaseUrl, anonKey, clientOptions);
	const { error: signInError } = await client.auth.signInWithPassword({ email, password });
	expectNoError(signInError, `sign in ${actor}`);
	clients[actor] = client;
}

async function fetchRatings() {
	const { data, error } = await admin
		.from('ratings')
		.select('user_id, rating, other_data')
		.eq('game_id', gameId)
		.order('user_id');
	expectNoError(error, 'fetch ratings');
	if (!data || data.length !== 2) throw new Error('Expected two ratings');
	return data;
}

function asPlayer(row: { rating: number; other_data: Json }): Player {
	const otherData = row.other_data as { rd?: number };
	return { rating: row.rating, rd: otherData.rd ?? defaultRD };
}

async function createPendingResult() {
	const { data, error } = await admin
		.from('game_results')
		.insert({
			game_id: gameId,
			reporter_id: userIds.reporter,
			winner_id: userIds.reporter,
			loser_id: userIds.opponent
		})
		.select('result_id')
		.single();
	expectNoError(error, 'create pending result');
	if (!data) throw new Error('No result returned');
	return data.result_id;
}

async function review(actor: Actor, decision: Decision, resultId: number) {
	return clients[actor].rpc('review_game_result', {
		p_result_id: resultId,
		p_decision: decision
	});
}

async function fetchResult(resultId: number) {
	const { data, error } = await admin
		.from('game_results')
		.select('status, reviewer_id')
		.eq('result_id', resultId)
		.single();
	expectNoError(error, 'fetch result');
	if (!data) throw new Error('No result returned');
	return data;
}

function expectRatingsUnchanged(
	before: Awaited<ReturnType<typeof fetchRatings>>,
	after: Awaited<ReturnType<typeof fetchRatings>>
) {
	expect(after.map(({ user_id, rating }) => ({ user_id, rating }))).toEqual(
		before.map(({ user_id, rating }) => ({ user_id, rating }))
	);
}

function expectSingleConfirmation(
	before: Awaited<ReturnType<typeof fetchRatings>>,
	after: Awaited<ReturnType<typeof fetchRatings>>
) {
	const winnerBefore = before.find((row) => row.user_id === userIds.reporter);
	const loserBefore = before.find((row) => row.user_id === userIds.opponent);
	const winnerAfter = after.find((row) => row.user_id === userIds.reporter);
	const loserAfter = after.find((row) => row.user_id === userIds.opponent);
	if (!winnerBefore || !loserBefore || !winnerAfter || !loserAfter) {
		throw new Error('Missing rating row');
	}

	const expectedWinner = getNewRating(asPlayer(winnerBefore), [asPlayer(loserBefore)], [1]);
	const expectedLoser = getNewRating(asPlayer(loserBefore), [asPlayer(winnerBefore)], [0]);
	expect(winnerAfter.rating).toBeCloseTo(expectedWinner.rating, 8);
	expect(loserAfter.rating).toBeCloseTo(expectedLoser.rating, 8);
}

beforeAll(async () => {
	await Promise.all([createActor('reporter'), createActor('opponent'), createActor('outsider')]);

	const { data: game, error: gameError } = await admin
		.from('games')
		.insert({ name: `Adversarial peer check ${runId}` })
		.select('game_id')
		.single();
	expectNoError(gameError, 'create game');
	if (!game) throw new Error('No game returned');
	gameId = game.game_id;

	const { error: ratingsError } = await admin.from('ratings').insert([
		{
			game_id: gameId,
			user_id: userIds.reporter,
			rating: 1200,
			other_data: { rd: defaultRD }
		},
		{
			game_id: gameId,
			user_id: userIds.opponent,
			rating: 1200,
			other_data: { rd: defaultRD }
		}
	]);
	expectNoError(ratingsError, 'create ratings');
});

afterAll(async () => {
	if (gameId) await admin.from('games').delete().eq('game_id', gameId);
	await Promise.all(createdUserIds.map((userId) => admin.auth.admin.deleteUser(userId)));
});

describe('game result state machine', () => {
	const commandArbitrary = fc.record<Command>({
		actor: fc.constantFrom<Actor>('reporter', 'opponent', 'outsider'),
		decision: fc.constantFrom<Decision>('confirm', 'dispute', 'invalid')
	});

	test('generated command traces agree with the transition oracle', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(commandArbitrary, { minLength: 1, maxLength: 8 }),
				async (commands) => {
					const resultId = await createPendingResult();
					const ratingsBefore = await fetchRatings();
					let expectedStatus: ResultStatus = 'pending';

					for (const command of commands) {
						const isTransition =
							expectedStatus === 'pending' &&
							command.actor === 'opponent' &&
							(command.decision === 'confirm' || command.decision === 'dispute');
						const isMatchingReplay =
							command.actor === 'opponent' &&
							((expectedStatus === 'confirmed' && command.decision === 'confirm') ||
								(expectedStatus === 'disputed' && command.decision === 'dispute'));

						const { error } = await review(command.actor, command.decision, resultId);
						expect(error === null).toBe(isTransition || isMatchingReplay);

						if (isTransition) {
							expectedStatus = command.decision === 'confirm' ? 'confirmed' : 'disputed';
						}
					}

					const result = await fetchResult(resultId);
					expect(result.status).toBe(expectedStatus);
					expect(result.reviewer_id).toBe(expectedStatus === 'pending' ? null : userIds.opponent);

					const ratingsAfter = await fetchRatings();
					if (expectedStatus === 'confirmed') {
						expectSingleConfirmation(ratingsBefore, ratingsAfter);
					} else {
						expectRatingsUnchanged(ratingsBefore, ratingsAfter);
					}
				}
			),
			{ numRuns: 30, seed: 0x6f70656e }
		);
	});

	test('simultaneous duplicate confirmations converge and rate exactly once', async () => {
		const resultId = await createPendingResult();
		const ratingsBefore = await fetchRatings();

		const attempts = await Promise.all([
			review('opponent', 'confirm', resultId),
			review('opponent', 'confirm', resultId)
		]);
		expect(attempts.every(({ error }) => error === null)).toBe(true);

		const result = await fetchResult(resultId);
		expect(result).toMatchObject({ status: 'confirmed', reviewer_id: userIds.opponent });
		expectSingleConfirmation(ratingsBefore, await fetchRatings());
	});

	test('simultaneous confirm/dispute races have one winner and no partial effects', async () => {
		for (let run = 0; run < 12; run += 1) {
			const resultId = await createPendingResult();
			const ratingsBefore = await fetchRatings();
			const decisions: ['confirm', 'dispute'] =
				run % 2 === 0 ? ['confirm', 'dispute'] : ['dispute', 'confirm'];

			const attempts = await Promise.all(
				decisions.map(async (decision) => ({
					decision,
					response: await review('opponent', decision, resultId)
				}))
			);
			const successful = attempts.filter(({ response }) => response.error === null);
			expect(successful).toHaveLength(1);

			const winningDecision = successful[0].decision;
			const result = await fetchResult(resultId);
			expect(result.status).toBe(winningDecision === 'confirm' ? 'confirmed' : 'disputed');
			expect(result.reviewer_id).toBe(userIds.opponent);

			const ratingsAfter = await fetchRatings();
			if (winningDecision === 'confirm') {
				expectSingleConfirmation(ratingsBefore, ratingsAfter);
			} else {
				expectRatingsUnchanged(ratingsBefore, ratingsAfter);
			}
		}
	});
});
