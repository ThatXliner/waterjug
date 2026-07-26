import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_RATING_CONFIGURATION, type RatingConfiguration } from './rating';
import type { Database } from './supabase';

const runtimeEnv =
	(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const fileEnv = loadEnv('test', '.', '');
const supabaseUrl = runtimeEnv.PUBLIC_SUPABASE_URL ?? fileEnv.PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
	runtimeEnv.PUBLIC_SUPABASE_ANON_KEY ?? fileEnv.PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceRoleKey =
	runtimeEnv.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY ?? '';
const runDatabaseTests = runtimeEnv.RUN_DATABASE_TESTS === 'true';
const localHostname = (() => {
	try {
		return new URL(supabaseUrl).hostname;
	} catch {
		return '';
	}
})();
const describeLocal =
	runDatabaseTests &&
	supabaseAnonKey.length > 0 &&
	serviceRoleKey.length > 0 &&
	(localHostname === '127.0.0.1' || localHostname === 'localhost')
		? describe
		: describe.skip;

type UserFixture = {
	id: string;
	client: SupabaseClient<Database>;
};

function configurationWithDefault(defaultRating: number): RatingConfiguration {
	return {
		...structuredClone(DEFAULT_RATING_CONFIGURATION),
		defaultRating
	};
}

function configurationForJoin(defaultRating: number, initialDeviation: number) {
	const configuration = configurationWithDefault(defaultRating);
	configuration.glicko.initialDeviation = initialDeviation;
	return configuration;
}

describeLocal('default-rating database invariants', () => {
	let admin: SupabaseClient<Database>;
	const runId = crypto.randomUUID();
	const password = `Rating-${runId}!`;
	const users: UserFixture[] = [];
	let gameId: number;
	let owner: UserFixture;
	let attacker: UserFixture;

	async function createUser(role: string): Promise<UserFixture> {
		const email = `rating-${role}-${runId}@example.test`;
		const { data, error } = await admin.auth.admin.createUser({
			email,
			password,
			email_confirm: true
		});
		if (error) throw error;

		const client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		if (signInError) throw signInError;
		return { id: data.user.id, client };
	}

	beforeAll(async () => {
		admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		const created = await Promise.all([
			createUser('owner'),
			createUser('attacker'),
			...Array.from({ length: 8 }, (_, index) => createUser(`player-${index}`)),
			createUser('late-player')
		]);
		users.push(...created);
		[owner, attacker] = created;

		const { data: game, error } = await admin
			.from('games')
			.insert({
				name: `Adversarial default rating ${runId}`,
				created_by: owner.id,
				rating_configuration: DEFAULT_RATING_CONFIGURATION
			})
			.select('game_id')
			.single();
		if (error) throw error;
		gameId = game.game_id;
	}, 30_000);

	afterAll(async () => {
		if (gameId) await admin.from('games').delete().eq('game_id', gameId);
		await Promise.all(users.map((user) => admin.auth.admin.deleteUser(user.id)));
	});

	test('rejects non-owner updates without changing the persisted configuration', async () => {
		const { data, error } = await attacker.client
			.from('games')
			.update({
				rating_configuration: configurationWithDefault(9999),
				rating_configuration_revision: 2
			})
			.eq('game_id', gameId)
			.select('rating_configuration, rating_configuration_revision');

		expect(error).toBeNull();
		expect(data).toEqual([]);

		const { data: persisted } = await admin
			.from('games')
			.select('rating_configuration, rating_configuration_revision')
			.eq('game_id', gameId)
			.single();
		expect(persisted?.rating_configuration).toEqual(DEFAULT_RATING_CONFIGURATION);
		expect(persisted?.rating_configuration_revision).toBe(1);
	});

	test.each([
		-Number.MIN_VALUE,
		-1,
		1_000_001,
		Number.MAX_SAFE_INTEGER,
		Number.MAX_VALUE,
		NaN,
		Infinity,
		-Infinity
	])('rejects invalid persisted default rating %s without mutation', async (invalid) => {
		let updateError: unknown;
		try {
			const result = await admin
				.from('games')
				.update({ rating_configuration: configurationWithDefault(invalid) })
				.eq('game_id', gameId);
			updateError = result.error;
		} catch (error) {
			updateError = error;
		}
		expect(updateError).toBeTruthy();

		const { data: persisted } = await admin
			.from('games')
			.select('rating_configuration')
			.eq('game_id', gameId)
			.single();
		expect(persisted?.rating_configuration).toEqual(DEFAULT_RATING_CONFIGURATION);
	});

	test('persists supported boundary and subnormal defaults exactly', async () => {
		const { data: initialGame, error: initialGameError } = await admin
			.from('games')
			.select('rating_configuration_revision')
			.eq('game_id', gameId)
			.single();
		expect(initialGameError).toBeNull();
		let revision = initialGame!.rating_configuration_revision;

		for (const defaultRating of [0, Number.MIN_VALUE, 1_000_000]) {
			const configuration = configurationWithDefault(defaultRating);
			const nextRevision = revision + 1;
			const { error } = await admin
				.from('games')
				.update({
					rating_configuration: configuration,
					rating_configuration_revision: nextRevision
				})
				.eq('game_id', gameId)
				.eq('rating_configuration_revision', revision);
			expect(error).toBeNull();

			const { data: persisted } = await admin
				.from('games')
				.select('rating_configuration')
				.eq('game_id', gameId)
				.single();
			expect(persisted?.rating_configuration).toEqual(configuration);
			revision = nextRevision;
		}

		const resetRevision = revision + 1;
		const { error } = await admin
			.from('games')
			.update({
				rating_configuration: DEFAULT_RATING_CONFIGURATION,
				rating_configuration_revision: resetRevision
			})
			.eq('game_id', gameId)
			.eq('rating_configuration_revision', revision);
		expect(error).toBeNull();
	});

	test('atomically snapshots configuration during concurrent first joins', async () => {
		const joiningUsers = users.slice(2, 10);
		const possibleConfigurations = [
			configurationForJoin(800, 80),
			configurationForJoin(1200, 120),
			configurationForJoin(1600, 160),
			configurationForJoin(2000, 200)
		];
		const expectedSnapshots = new Set([
			`${DEFAULT_RATING_CONFIGURATION.defaultRating}:${DEFAULT_RATING_CONFIGURATION.glicko.initialDeviation}`,
			...possibleConfigurations.map(
				(configuration) => `${configuration.defaultRating}:${configuration.glicko.initialDeviation}`
			)
		]);
		const { data: initialGame, error: initialGameError } = await admin
			.from('games')
			.select('rating_configuration_revision')
			.eq('game_id', gameId)
			.single();
		expect(initialGameError).toBeNull();
		const initialRevision = initialGame!.rating_configuration_revision;
		const updates = possibleConfigurations.map((configuration) =>
			owner.client
				.from('games')
				.update({
					rating_configuration: configuration,
					rating_configuration_revision: initialRevision + 1
				})
				.eq('game_id', gameId)
				.eq('rating_configuration_revision', initialRevision)
		);
		const joins = joiningUsers.flatMap((user) =>
			Array.from({ length: 5 }, () => user.client.rpc('ensure_game_rating', { p_game_id: gameId }))
		);

		const results = await Promise.all([...updates, ...joins]);
		expect(results.every(({ error }) => error === null)).toBe(true);

		const { data: ratings, error } = await admin
			.from('ratings')
			.select('user_id, rating, type, other_data')
			.eq('game_id', gameId)
			.in(
				'user_id',
				joiningUsers.map((user) => user.id)
			);
		expect(error).toBeNull();
		expect(ratings).toHaveLength(joiningUsers.length);
		expect(new Set(ratings?.map(({ user_id }) => user_id)).size).toBe(joiningUsers.length);
		expect(ratings?.every(({ type }) => type === 'glicko')).toBe(true);
		expect(
			ratings?.every(({ rating, other_data }) => {
				const metadata = other_data as {
					deviation?: number;
					volatility?: number;
					lastRatedAt?: string;
				};
				return (
					expectedSnapshots.has(`${rating}:${metadata.deviation}`) &&
					metadata.volatility === DEFAULT_RATING_CONFIGURATION.glicko.initialVolatility &&
					!Number.isNaN(Date.parse(metadata.lastRatedAt ?? ''))
				);
			})
		).toBe(true);

		const snapshots = new Map(ratings?.map(({ user_id, rating }) => [user_id, rating]));
		const finalConfiguration = configurationForJoin(1777, 177);
		const { data: currentGame, error: currentGameError } = await admin
			.from('games')
			.select('rating_configuration_revision')
			.eq('game_id', gameId)
			.single();
		expect(currentGameError).toBeNull();
		const { error: finalUpdateError } = await owner.client
			.from('games')
			.update({
				rating_configuration: finalConfiguration,
				rating_configuration_revision: currentGame!.rating_configuration_revision + 1
			})
			.eq('game_id', gameId)
			.eq('rating_configuration_revision', currentGame!.rating_configuration_revision);
		expect(finalUpdateError).toBeNull();

		const latePlayer = users[10];
		const lateJoins = await Promise.all(
			Array.from({ length: 10 }, () =>
				latePlayer.client.rpc('ensure_game_rating', { p_game_id: gameId })
			)
		);
		expect(lateJoins.every(({ error: lateError }) => lateError === null)).toBe(true);

		const { data: persistedRatings } = await admin
			.from('ratings')
			.select('user_id, rating, other_data')
			.eq('game_id', gameId);
		const persistedByUser = new Map(
			persistedRatings?.map(({ user_id, rating }) => [user_id, rating])
		);
		for (const [userId, rating] of snapshots) {
			expect(persistedByUser.get(userId)).toBe(rating);
		}
		expect(persistedByUser.get(latePlayer.id)).toBe(1777);
		expect(persistedRatings?.filter(({ user_id }) => user_id === latePlayer.id)).toHaveLength(1);
		expect(
			(
				persistedRatings?.find(({ user_id }) => user_id === latePlayer.id)?.other_data as {
					deviation?: number;
					volatility?: number;
				}
			)?.deviation
		).toBe(177);
		expect(
			(
				persistedRatings?.find(({ user_id }) => user_id === latePlayer.id)?.other_data as {
					volatility?: number;
				}
			)?.volatility
		).toBe(finalConfiguration.glicko.initialVolatility);
	}, 30_000);
});
