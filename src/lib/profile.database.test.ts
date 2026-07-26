import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './supabase';

const databaseTestsEnabled = process.env.RUN_DATABASE_TESTS === 'true';
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const password = 'profile-adversarial-test-password';

type TestUser = {
	id: string;
	client: SupabaseClient<Database>;
};

describe.skipIf(!databaseTestsEnabled).sequential('public profile database invariants', () => {
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

	async function createUser(username: string): Promise<TestUser> {
		const email = `profile-test-${crypto.randomUUID()}@example.com`;
		const { data: created, error: createError } = await admin.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
			user_metadata: { username }
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

	async function storedProfile(userId: string) {
		const { data, error } = await admin
			.from('profiles')
			.select('display_name, username')
			.eq('user_id', userId)
			.single();
		expect(error).toBeNull();
		return data!;
	}

	it('keeps public reads open while only the owner can change the display name', async () => {
		const owner = await createUser('profile_owner');
		const attacker = await createUser('profile_attacker');
		const anonymous = createClient<Database>(supabaseUrl, anonKey, {
			auth: { persistSession: false, autoRefreshToken: false }
		});

		const ownerUpdate = await owner.client
			.from('profiles')
			.update({ display_name: 'Water Wizard' })
			.eq('user_id', owner.id)
			.select('display_name, username')
			.single();
		expect(ownerUpdate.error).toBeNull();
		expect(ownerUpdate.data).toEqual({
			display_name: 'Water Wizard',
			username: 'profile_owner'
		});

		for (const client of [anonymous, attacker.client]) {
			const publicRead = await client
				.from('profiles')
				.select('display_name, username')
				.eq('user_id', owner.id)
				.single();
			expect(publicRead.error).toBeNull();
			expect(publicRead.data).toEqual({
				display_name: 'Water Wizard',
				username: 'profile_owner'
			});
		}

		const crossUserUpdate = await attacker.client
			.from('profiles')
			.update({ display_name: 'Hijacked' })
			.eq('user_id', owner.id)
			.select('display_name');
		expect(crossUserUpdate.error).toBeNull();
		expect(crossUserUpdate.data).toEqual([]);

		const anonymousUpdate = await anonymous
			.from('profiles')
			.update({ display_name: 'Anonymous' })
			.eq('user_id', owner.id)
			.select('display_name');
		expect(anonymousUpdate.error?.code).toBe('42501');
		expect(await storedProfile(owner.id)).toEqual({
			display_name: 'Water Wizard',
			username: 'profile_owner'
		});
	});

	it('enforces display-name boundaries without changing the canonical username', async () => {
		const owner = await createUser('boundary_owner');
		const emoji = '🫗';

		const boundaryUpdate = await owner.client
			.from('profiles')
			.update({ display_name: emoji.repeat(50) })
			.eq('user_id', owner.id);
		expect(boundaryUpdate.error).toBeNull();

		for (const [displayName, expectedCode] of [
			[emoji.repeat(51), '23514'],
			['player\nname', '23514'],
			['player\u0000name', '22P05']
		] as const) {
			const invalidUpdate = await owner.client
				.from('profiles')
				.update({ display_name: displayName })
				.eq('user_id', owner.id);
			expect(invalidUpdate.error?.code).toBe(expectedCode);
			expect(await storedProfile(owner.id)).toEqual({
				display_name: emoji.repeat(50),
				username: 'boundary_owner'
			});
		}
	});
});
