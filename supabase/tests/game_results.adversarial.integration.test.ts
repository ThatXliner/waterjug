import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../src/lib/supabase';

type Actor = 'reporter' | 'opponent' | 'outsider';
type Decision = 'confirmed' | 'disputed' | 'invalid';
type Command = { actor: Actor; decision: Decision };
type ResultStatus = 'pending' | 'confirmed' | 'disputed';
type RatingRow = {
	user_id: string;
	rating: number;
	type: string;
	other_data: Json;
};

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
const emails = {} as Record<Actor, string>;
const createdUserIds: string[] = [];
const createdGameIds: number[] = [];
const runId = randomUUID();
let gameId: number;
let privateGameId: number;
let otherGameId: number;

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
	emails[actor] = email;
	createdUserIds.push(data.user.id);

	const client = createClient<Database>(supabaseUrl, anonKey, clientOptions);
	const { error: signInError } = await client.auth.signInWithPassword({ email, password });
	expectNoError(signInError, `sign in ${actor}`);
	clients[actor] = client;
}

async function createGame(
	name: string,
	createdBy: string,
	inviteOnly = false,
	invitedEmails: string[] = []
) {
	const { data, error } = await admin
		.from('games')
		.insert({ name, created_by: createdBy, invite_only: inviteOnly })
		.select('game_id')
		.single();
	expectNoError(error, `create ${name}`);
	if (!data) throw new Error(`No game returned for ${name}`);
	createdGameIds.push(data.game_id);

	if (invitedEmails.length > 0) {
		const { error: inviteError } = await admin.from('game_invites').insert(
			invitedEmails.map((email) => ({
				game_id: data.game_id,
				invited_email: email,
				invited_by: createdBy
			}))
		);
		expectNoError(inviteError, `invite players to ${name}`);
	}
	return data.game_id;
}

async function addRatings(targetGameId: number, actors: Actor[]) {
	const { error } = await admin.from('ratings').insert(
		actors.map((actor) => ({
			game_id: targetGameId,
			user_id: userIds[actor],
			rating: 1200,
			type: 'glicko',
			other_data: { deviation: 350 }
		}))
	);
	expectNoError(error, `create ratings for game ${targetGameId}`);
}

async function fetchRatings(targetGameId = gameId) {
	const { data, error } = await admin
		.from('ratings')
		.select('user_id, rating, type, other_data')
		.eq('game_id', targetGameId)
		.order('user_id');
	expectNoError(error, 'fetch ratings');
	if (!data) throw new Error('No ratings returned');
	return data as RatingRow[];
}

async function createPendingResult(
	targetGameId = gameId,
	submissionId = randomUUID(),
	winner: Actor = 'reporter',
	loser: Actor = 'opponent'
) {
	const { data, error } = await clients.reporter
		.from('game_results')
		.insert({
			game_id: targetGameId,
			reporter_id: userIds.reporter,
			submission_id: submissionId,
			winner_id: userIds[winner],
			loser_id: userIds[loser]
		})
		.select('id')
		.single();
	expectNoError(error, 'create pending result');
	if (!data) throw new Error('No result returned');
	return data.id;
}

async function fetchResult(resultId: number) {
	const { data, error } = await admin.from('game_results').select('*').eq('id', resultId).single();
	expectNoError(error, 'fetch result');
	if (!data) throw new Error('No result returned');
	return data;
}

async function review(actor: Actor, decision: Decision, resultId: number) {
	const result = await fetchResult(resultId);
	const updates =
		decision === 'confirmed'
			? {
					p_winner_new_rating: result.winner_rating_snapshot + 17,
					p_winner_new_type: result.winner_type_snapshot,
					p_winner_new_other_data: result.winner_other_data_snapshot,
					p_loser_new_rating: result.loser_rating_snapshot - 13,
					p_loser_new_type: result.loser_type_snapshot,
					p_loser_new_other_data: result.loser_other_data_snapshot
				}
			: {};
	return admin.rpc('review_game_result', {
		p_result_id: resultId,
		p_reviewer_id: userIds[actor],
		p_decision: decision,
		p_expected_configuration_revision: result.configuration_revision,
		...updates
	});
}

function ratingsByUser(rows: RatingRow[]) {
	return new Map(rows.map((row) => [row.user_id, row]));
}

function expectRatingsUnchanged(before: RatingRow[], after: RatingRow[]) {
	expect(after).toEqual(before);
}

function expectSingleConfirmation(before: RatingRow[], after: RatingRow[]) {
	const oldRatings = ratingsByUser(before);
	const newRatings = ratingsByUser(after);
	expect(newRatings.get(userIds.reporter)?.rating).toBe(
		(oldRatings.get(userIds.reporter)?.rating ?? 0) + 17
	);
	expect(newRatings.get(userIds.opponent)?.rating).toBe(
		(oldRatings.get(userIds.opponent)?.rating ?? 0) - 13
	);
}

beforeAll(async () => {
	await Promise.all([createActor('reporter'), createActor('opponent'), createActor('outsider')]);

	gameId = await createGame(`Adversarial peer check ${runId}`, userIds.reporter);
	privateGameId = await createGame(`Private peer check ${runId}`, userIds.reporter, true, [
		emails.opponent
	]);
	otherGameId = await createGame(`Isolation fixture ${runId}`, userIds.outsider);
	await addRatings(gameId, ['reporter', 'opponent']);
	await addRatings(privateGameId, ['reporter', 'opponent']);
	await addRatings(otherGameId, ['outsider']);
});

afterAll(async () => {
	await Promise.all(createdGameIds.map((id) => admin.from('games').delete().eq('game_id', id)));
	await Promise.all(createdUserIds.map((userId) => admin.auth.admin.deleteUser(userId)));
});

describe('game result state-machine invariants', () => {
	const commandArbitrary = fc.record<Command>({
		actor: fc.constantFrom<Actor>('reporter', 'opponent', 'outsider'),
		decision: fc.constantFrom<Decision>('confirmed', 'disputed', 'invalid')
	});

	test('generated transition traces agree with the model and rate at most once', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(commandArbitrary, { minLength: 1, maxLength: 10 }),
				async (commands) => {
					const resultId = await createPendingResult();
					const ratingsBefore = await fetchRatings();
					let expectedStatus: ResultStatus = 'pending';

					for (const command of commands) {
						const isTransition =
							expectedStatus === 'pending' &&
							command.actor === 'opponent' &&
							(command.decision === 'confirmed' || command.decision === 'disputed');
						const isMatchingReplay =
							command.actor === 'opponent' &&
							command.decision === expectedStatus &&
							expectedStatus !== 'pending';

						const { error } = await review(command.actor, command.decision, resultId);
						expect(error === null).toBe(isTransition || isMatchingReplay);
						if (isTransition) expectedStatus = command.decision as ResultStatus;
					}

					const result = await fetchResult(resultId);
					expect(result.status).toBe(expectedStatus);
					expect(result.reviewed_by).toBe(expectedStatus === 'pending' ? null : userIds.opponent);

					const ratingsAfter = await fetchRatings();
					if (expectedStatus === 'confirmed') {
						expectSingleConfirmation(ratingsBefore, ratingsAfter);
					} else {
						expectRatingsUnchanged(ratingsBefore, ratingsAfter);
					}
				}
			),
			{ numRuns: 40, seed: 0x70656572 }
		);
	});

	test('authenticated callers cannot bypass the server review boundary', async () => {
		const resultId = await createPendingResult();
		const result = await fetchResult(resultId);
		const { error } = await clients.opponent.rpc('review_game_result', {
			p_result_id: resultId,
			p_reviewer_id: userIds.opponent,
			p_decision: 'disputed',
			p_expected_configuration_revision: result.configuration_revision
		});
		expect(error?.code).toBe('42501');
		expect((await fetchResult(resultId)).status).toBe('pending');
	});

	test('a replayed submission key creates exactly one pending claim', async () => {
		const submissionId = randomUUID();
		const insert = () =>
			clients.reporter.from('game_results').insert({
				game_id: gameId,
				reporter_id: userIds.reporter,
				submission_id: submissionId,
				winner_id: userIds.reporter,
				loser_id: userIds.opponent
			});
		const attempts = await Promise.all([insert(), insert()]);
		expect(attempts.filter(({ error }) => error === null)).toHaveLength(1);
		expect(attempts.find(({ error }) => error)?.error?.code).toBe('23505');
		const { count, error } = await admin
			.from('game_results')
			.select('*', { count: 'exact', head: true })
			.eq('submission_id', submissionId);
		expectNoError(error, 'count replayed submission');
		expect(count).toBe(1);
	});

	test('simultaneous duplicate confirmations converge and apply once', async () => {
		const resultId = await createPendingResult();
		const ratingsBefore = await fetchRatings();
		const attempts = await Promise.all([
			review('opponent', 'confirmed', resultId),
			review('opponent', 'confirmed', resultId)
		]);
		expect(attempts.every(({ error }) => error === null)).toBe(true);
		expect((await fetchResult(resultId)).status).toBe('confirmed');
		expectSingleConfirmation(ratingsBefore, await fetchRatings());
	});

	test('simultaneous confirmation/dispute has one winner and no partial effects', async () => {
		for (let run = 0; run < 12; run += 1) {
			const resultId = await createPendingResult();
			const ratingsBefore = await fetchRatings();
			const decisions: ['confirmed', 'disputed'] =
				run % 2 === 0 ? ['confirmed', 'disputed'] : ['disputed', 'confirmed'];
			const attempts = await Promise.all(
				decisions.map(async (decision) => ({
					decision,
					response: await review('opponent', decision, resultId)
				}))
			);
			const successful = attempts.filter(({ response }) => response.error === null);
			expect(successful).toHaveLength(1);

			const winningDecision = successful[0].decision;
			expect((await fetchResult(resultId)).status).toBe(winningDecision);
			const ratingsAfter = await fetchRatings();
			if (winningDecision === 'confirmed') {
				expectSingleConfirmation(ratingsBefore, ratingsAfter);
			} else {
				expectRatingsUnchanged(ratingsBefore, ratingsAfter);
			}
		}
	});

	test('two confirmations from the same rating snapshot cannot both commit', async () => {
		const firstResult = await createPendingResult();
		const secondResult = await createPendingResult();
		const ratingsBefore = await fetchRatings();
		const attempts = await Promise.all([
			review('opponent', 'confirmed', firstResult),
			review('opponent', 'confirmed', secondResult)
		]);
		expect(attempts.filter(({ error }) => error === null)).toHaveLength(1);
		expect(attempts.find(({ error }) => error)?.error?.code).toBe('PT409');

		const statuses = await Promise.all([
			fetchResult(firstResult).then((result) => result.status),
			fetchResult(secondResult).then((result) => result.status)
		]);
		expect(statuses.sort()).toEqual(['confirmed', 'pending']);
		expectSingleConfirmation(ratingsBefore, await fetchRatings());
	});

	test('stale rating and configuration snapshots cannot confirm', async () => {
		const staleRatingResult = await createPendingResult();
		const beforeRatingMutation = await fetchResult(staleRatingResult);
		const { error: ratingMutationError } = await admin
			.from('ratings')
			.update({ rating: beforeRatingMutation.winner_rating_snapshot + 1 })
			.eq('game_id', gameId)
			.eq('user_id', beforeRatingMutation.winner_id);
		expectNoError(ratingMutationError, 'mutate rating');
		expect((await review('opponent', 'confirmed', staleRatingResult)).error?.code).toBe('PT409');
		expect((await fetchResult(staleRatingResult)).status).toBe('pending');
		expect((await review('opponent', 'disputed', staleRatingResult)).error).toBeNull();

		const staleConfigurationResult = await createPendingResult();
		const staleConfiguration = await fetchResult(staleConfigurationResult);
		const { error: configMutationError } = await admin
			.from('games')
			.update({
				rating_configuration_revision: staleConfiguration.configuration_revision + 1
			})
			.eq('game_id', gameId);
		expectNoError(configMutationError, 'mutate configuration revision');
		expect((await review('opponent', 'confirmed', staleConfigurationResult)).error?.code).toBe(
			'PT409'
		);
		expect((await fetchResult(staleConfigurationResult)).status).toBe('pending');
	});

	test('cross-game rating identities cannot be injected into a report', async () => {
		const { error } = await clients.reporter.from('game_results').insert({
			game_id: gameId,
			reporter_id: userIds.reporter,
			submission_id: randomUUID(),
			winner_id: userIds.reporter,
			loser_id: userIds.outsider
		});
		expect(error?.code).toBe('23503');
	});

	test('private result visibility and authorization disappear on invite revocation', async () => {
		const resultId = await createPendingResult(privateGameId);
		const visible = await clients.opponent.from('game_results').select('id').eq('id', resultId);
		expectNoError(visible.error, 'read invited result');
		expect(visible.data).toHaveLength(1);

		const { error: revokeError } = await admin
			.from('game_invites')
			.delete()
			.eq('game_id', privateGameId)
			.eq('invited_email', emails.opponent);
		expectNoError(revokeError, 'revoke invite');

		const hidden = await clients.opponent.from('game_results').select('id').eq('id', resultId);
		expectNoError(hidden.error, 'query revoked result');
		expect(hidden.data).toHaveLength(0);
		expect((await review('opponent', 'disputed', resultId)).error?.code).toBe('42501');
		expect((await fetchResult(resultId)).status).toBe('pending');

		const { error: restoreError } = await admin.from('game_invites').insert({
			game_id: privateGameId,
			invited_email: emails.opponent,
			invited_by: userIds.reporter
		});
		expectNoError(restoreError, 'restore invite');
		expect((await review('opponent', 'disputed', resultId)).error).toBeNull();
		expect((await fetchResult(resultId)).status).toBe('disputed');
	});
});
