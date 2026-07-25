import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './supabase';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const password = 'adversarial-test-password';

type TestUser = {
	id: string;
	client: SupabaseClient<Database>;
};

describe.skipIf(!databaseTestsEnabled).sequential('username database invariants', () => {
	let admin: SupabaseClient<Database>;
	const createdUserIds = new Set<string>();

	beforeAll(() => {
		if (!supabaseUrl || !anonKey || !serviceRoleKey) {
			throw new Error('Database tests require local Supabase URL, anon key, and service role key');
		}
		admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	});

	afterEach(async () => {
		await Promise.all([...createdUserIds].map((userId) => admin.auth.admin.deleteUser(userId)));
		createdUserIds.clear();
	});

	async function createUser(username?: string): Promise<TestUser> {
		const email = `username-test-${crypto.randomUUID()}@example.com`;
		const { data: created, error: createError } = await admin.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			user_metadata: username === undefined ? {} : { username }
		});
		expect(createError).toBeNull();
		expect(created.user).not.toBeNull();
		const userId = created.user!.id;
		createdUserIds.add(userId);

		const client = createClient<Database>(supabaseUrl, anonKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
		const { error: signInError } = await client.auth.signInWithPassword({ email, password });
		expect(signInError).toBeNull();
		return { id: userId, client };
	}

	async function storedUsername(userId: string): Promise<string | null> {
		const { data, error } = await admin
			.from('profiles')
			.select('username')
			.eq('user_id', userId)
			.single();
		expect(error).toBeNull();
		return data!.username;
	}

	it('normalizes trigger input and enforces invalid database transitions', async () => {
		const user = await createUser('  Boundary_User9  ');
		expect(await storedUsername(user.id)).toBe('boundary_user9');

		const invalidValues = [
			'ab',
			`a${'b'.repeat(30)}`,
			'_leading',
			'trailing_',
			'has-dash',
			'has space',
			'UPPERCASE',
			'naïve',
			'水user'
		];

		for (const username of invalidValues) {
			const { error } = await admin.from('profiles').update({ username }).eq('user_id', user.id);
			expect(error?.code).toBe('23514');
			expect(await storedUsername(user.id)).toBe('boundary_user9');
		}
	});

	it('allows the owner to claim and change a username', async () => {
		const user = await createUser();
		expect(await storedUsername(user.id)).toBeNull();

		const firstUpdate = await user.client
			.from('profiles')
			.update({ username: 'first_name' })
			.eq('user_id', user.id)
			.select('username')
			.single();
		expect(firstUpdate.error).toBeNull();
		expect(firstUpdate.data?.username).toBe('first_name');

		const secondUpdate = await user.client
			.from('profiles')
			.update({ username: 'second_name' })
			.eq('user_id', user.id)
			.select('username')
			.single();
		expect(secondUpdate.error).toBeNull();
		expect(await storedUsername(user.id)).toBe('second_name');

		for (const boundaryUsername of ['a1b', `a${'1'.repeat(28)}b`]) {
			const { error } = await user.client
				.from('profiles')
				.update({ username: boundaryUsername })
				.eq('user_id', user.id);
			expect(error).toBeNull();
			expect(await storedUsername(user.id)).toBe(boundaryUsername);
		}
	});

	it('prevents anonymous and cross-user profile updates', async () => {
		const owner = await createUser('profile_owner');
		const attacker = await createUser('profile_attacker');
		const anonymous = createClient<Database>(supabaseUrl, anonKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});

		const crossUserResult = await attacker.client
			.from('profiles')
			.update({ username: 'stolen_name' })
			.eq('user_id', owner.id)
			.select('username');
		expect(crossUserResult.error).toBeNull();
		expect(crossUserResult.data).toEqual([]);

		const anonymousResult = await anonymous
			.from('profiles')
			.update({ username: 'anonymous_name' })
			.eq('user_id', owner.id)
			.select('username');
		expect(anonymousResult.error?.code).toBe('42501');
		expect(anonymousResult.data).toBeNull();
		expect(await storedUsername(owner.id)).toBe('profile_owner');
	});

	it('allows exactly one winner when two users concurrently claim a username', async () => {
		const first = await createUser();
		const second = await createUser();

		const results = await Promise.all(
			[first, second].map(({ id, client }) =>
				client
					.from('profiles')
					.update({ username: 'contested_name' })
					.eq('user_id', id)
					.select('username')
					.single()
			)
		);

		const successes = results.filter(({ error }) => error === null);
		const conflicts = results.filter(({ error }) => error?.code === '23505');
		expect(successes).toHaveLength(1);
		expect(conflicts).toHaveLength(1);

		const { count, error } = await admin
			.from('profiles')
			.select('*', { count: 'exact', head: true })
			.eq('username', 'contested_name');
		expect(error).toBeNull();
		expect(count).toBe(1);
	});
});
