import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './supabase';

const environment = (
	globalThis as typeof globalThis & {
		process?: { env?: Record<string, string | undefined> };
	}
).process?.env;
const apiUrl = environment?.PUBLIC_SUPABASE_URL;
const anonKey = environment?.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = environment?.SUPABASE_SERVICE_ROLE_KEY;
const hasSupabaseEnvironment = Boolean(apiUrl && anonKey && serviceRoleKey);

describe.skipIf(!hasSupabaseEnvironment)('invite-only games through the Data API', () => {
	const runId = crypto.randomUUID();
	const gamePrefix = `adversarial-${runId}`;
	const password = `Test-${runId}-A1!`;
	const emails = {
		owner: `owner-${runId}@example.test`,
		invited: `invited-${runId}@example.test`,
		outsider: `outsider-${runId}@example.test`
	};

	let service: SupabaseClient<Database>;
	let anonymous: SupabaseClient<Database>;
	let owner: SupabaseClient<Database>;
	let invited: SupabaseClient<Database>;
	let outsider: SupabaseClient<Database>;
	let ownerId: string;
	let invitedId: string;
	let outsiderId: string;

	async function createUser(email: string) {
		const { data, error } = await service.auth.admin.createUser({
			email,
			password,
			email_confirm: true
		});
		expect(error).toBeNull();
		return data.user!.id;
	}

	async function signedInClient(email: string) {
		const client = createClient<Database>(apiUrl!, anonKey!);
		const { error } = await client.auth.signInWithPassword({ email, password });
		expect(error).toBeNull();
		return client;
	}

	async function createPrivateGame(name: string, invitedEmails: string[]) {
		const { data, error } = await owner.rpc('create_game', {
			game_name: name,
			is_invite_only: true,
			invited_emails: invitedEmails
		});
		expect(error).toBeNull();
		expect(data).toEqual(expect.any(Number));
		return data!;
	}

	beforeAll(async () => {
		service = createClient<Database>(apiUrl!, serviceRoleKey!, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		anonymous = createClient<Database>(apiUrl!, anonKey!);

		[ownerId, invitedId, outsiderId] = await Promise.all([
			createUser(emails.owner),
			createUser(emails.invited),
			createUser(emails.outsider)
		]);
		[owner, invited, outsider] = await Promise.all([
			signedInClient(emails.owner),
			signedInClient(emails.invited),
			signedInClient(emails.outsider)
		]);
	}, 30_000);

	afterAll(async () => {
		if (!service) return;
		await service.from('games').delete().like('name', `${gamePrefix}%`);
		await Promise.all(
			[ownerId, invitedId, outsiderId]
				.filter(Boolean)
				.map((userId) => service.auth.admin.deleteUser(userId))
		);
	}, 30_000);

	it('rejects unauthenticated, empty, and malformed creation atomically', async () => {
		const cases = [
			{
				label: 'anonymous caller',
				client: anonymous,
				name: `${gamePrefix}-anonymous`,
				emails: [emails.invited],
				code: '42501'
			},
			{
				label: 'whitespace-only game name',
				client: owner,
				name: ' \t\n',
				emails: [emails.invited],
				code: '22023'
			},
			{
				label: 'null game name',
				client: owner,
				name: null as unknown as string,
				emails: [emails.invited],
				code: '22023'
			},
			{
				label: 'empty invite list',
				client: owner,
				name: `${gamePrefix}-empty`,
				emails: [],
				code: '22023'
			},
			{
				label: 'null invite list',
				client: owner,
				name: `${gamePrefix}-null-invites`,
				emails: null as unknown as string[],
				code: '22023'
			},
			{
				label: 'malformed invite',
				client: owner,
				name: `${gamePrefix}-malformed`,
				emails: [emails.invited, 'not-an-email'],
				code: '22023'
			}
		];

		for (const testCase of cases) {
			const { error } = await testCase.client.rpc('create_game', {
				game_name: testCase.name,
				is_invite_only: true,
				invited_emails: testCase.emails
			});
			expect(error?.code, testCase.label).toBe(testCase.code);
		}

		const { count, error } = await service
			.from('games')
			.select('*', { count: 'exact', head: true })
			.like('name', `${gamePrefix}-%`);
		expect(error).toBeNull();
		expect(count).toBe(0);
	});

	it('deduplicates invitations and commits the game plus invites as one state', async () => {
		const name = `${gamePrefix}-normalized`;
		const gameId = await createPrivateGame(name, [
			emails.invited.toUpperCase(),
			emails.invited,
			`  ${emails.outsider.toUpperCase()}  `
		]);

		const { data: game } = await service
			.from('games')
			.select('name, invite_only, created_by')
			.eq('game_id', gameId)
			.single();
		const { data: gameInvites } = await service
			.from('game_invites')
			.select('invited_email')
			.eq('game_id', gameId)
			.order('invited_email');

		expect(game).toEqual({ name, invite_only: true, created_by: ownerId });
		expect(gameInvites).toEqual([
			{ invited_email: emails.invited },
			{ invited_email: emails.outsider }
		]);
	});

	it('revokes and restores access as invitations transition state', async () => {
		const gameId = await createPrivateGame(`${gamePrefix}-transition`, [emails.invited]);

		const { data: visibleBefore } = await invited
			.from('games')
			.select('game_id')
			.eq('game_id', gameId)
			.maybeSingle();
		expect(visibleBefore?.game_id).toBe(gameId);

		const { error: joinError } = await invited.from('ratings').insert({
			game_id: gameId,
			user_id: invitedId
		});
		expect(joinError).toBeNull();

		const { error: deleteError } = await owner
			.from('game_invites')
			.delete()
			.eq('game_id', gameId)
			.eq('invited_email', emails.invited);
		expect(deleteError).toBeNull();

		const { data: hiddenGame } = await invited
			.from('games')
			.select('game_id')
			.eq('game_id', gameId)
			.maybeSingle();
		const { data: hiddenRating } = await invited
			.from('ratings')
			.select('user_id')
			.eq('game_id', gameId);
		const { error: deniedRejoin } = await invited
			.from('ratings')
			.upsert(
				{ game_id: gameId, user_id: invitedId },
				{ onConflict: 'user_id,game_id', ignoreDuplicates: true }
			);
		expect(hiddenGame).toBeNull();
		expect(hiddenRating).toEqual([]);
		expect(deniedRejoin?.code).toBe('42501');

		const { error: restoreError } = await owner.from('game_invites').insert({
			game_id: gameId,
			invited_email: emails.invited,
			invited_by: ownerId
		});
		expect(restoreError).toBeNull();

		const { data: restoredGame } = await invited
			.from('games')
			.select('game_id')
			.eq('game_id', gameId)
			.maybeSingle();
		const { data: restoredRating } = await invited
			.from('ratings')
			.select('user_id')
			.eq('game_id', gameId);
		expect(restoredGame?.game_id).toBe(gameId);
		expect(restoredRating).toEqual([{ user_id: invitedId }]);
	});

	it('prevents cross-game access and forged ownership or invitations', async () => {
		const ownerGameId = await createPrivateGame(`${gamePrefix}-owner-scope`, [emails.invited]);
		const { data: outsiderGameId, error: outsiderCreateError } = await outsider.rpc('create_game', {
			game_name: `${gamePrefix}-outsider-scope`,
			is_invite_only: true,
			invited_emails: [emails.outsider]
		});
		expect(outsiderCreateError).toBeNull();

		const { error: forgedGameError } = await invited.from('games').insert({
			name: `${gamePrefix}-forged-owner`,
			created_by: outsiderId,
			invite_only: true
		});
		const { error: forgedInviteError } = await invited.from('game_invites').insert({
			game_id: outsiderGameId!,
			invited_email: emails.invited,
			invited_by: invitedId
		});
		const { data: leakedOwnerGame } = await outsider
			.from('games')
			.select('game_id')
			.eq('game_id', ownerGameId);
		const { data: leakedOutsiderGame } = await invited
			.from('games')
			.select('game_id')
			.eq('game_id', outsiderGameId!);

		expect(forgedGameError?.code).toBe('42501');
		expect(forgedInviteError).not.toBeNull();
		expect(leakedOwnerGame).toEqual([]);
		expect(leakedOutsiderGame).toEqual([]);
	});

	it('converges concurrent invited joins to one row and denies every outsider race', async () => {
		const gameId = await createPrivateGame(`${gamePrefix}-race`, [emails.invited]);
		const invitedAttempts = await Promise.all(
			Array.from({ length: 25 }, () =>
				invited
					.from('ratings')
					.upsert(
						{ game_id: gameId, user_id: invitedId },
						{ onConflict: 'user_id,game_id', ignoreDuplicates: true }
					)
			)
		);
		expect(invitedAttempts.every(({ error }) => error === null)).toBe(true);

		const outsiderAttempts = await Promise.all(
			Array.from({ length: 25 }, () =>
				outsider.from('ratings').insert({ game_id: gameId, user_id: outsiderId })
			)
		);
		expect(outsiderAttempts.every(({ error }) => error?.code === '42501')).toBe(true);

		const { data: ratings, error } = await service
			.from('ratings')
			.select('user_id')
			.eq('game_id', gameId);
		expect(error).toBeNull();
		expect(ratings).toEqual([{ user_id: invitedId }]);
	}, 30_000);
});
