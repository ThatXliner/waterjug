import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '$lib/supabase';

const url = process.env.PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const hasDatabase =
	process.env.RUN_DATABASE_TESTS === 'true' && Boolean(url && anonKey && serviceRoleKey);
const databaseDescribe = hasDatabase ? describe : describe.skip;

function publicClient(): SupabaseClient<Database> {
	return createClient<Database>(url, anonKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}

databaseDescribe('Supabase authorization invariants', () => {
	it('enforces roles, ownership, credential, RPC, and concurrency boundaries', async () => {
		const service = createClient<Database>(url, serviceRoleKey, {
			auth: { autoRefreshToken: false, persistSession: false }
		});
		const suffix = crypto.randomUUID();
		const password = `WaterJug-${suffix}!`;
		const users: string[] = [];
		let gameId: number | undefined;
		let tournamentId: number | undefined;

		try {
			const actors = await Promise.all(
				(['admin', 'player'] as const).map(async (name) => {
					const email = `${name}-${suffix}@example.test`;
					const { data, error } = await service.auth.admin.createUser({
						email,
						password,
						email_confirm: true
					});
					expect(error).toBeNull();
					expect(data.user).not.toBeNull();
					const id = data.user!.id;
					users.push(id);

					const client = publicClient();
					const { error: signInError } = await client.auth.signInWithPassword({ email, password });
					expect(signInError).toBeNull();
					return { name, id, client };
				})
			);
			const admin = actors[0];
			const player = actors[1];

			const { data: initialProfiles, error: profileError } = await service
				.from('profiles')
				.select('user_id, role')
				.in('user_id', users);
			expect(profileError).toBeNull();
			expect(initialProfiles).toHaveLength(2);
			expect(initialProfiles?.every(({ role }) => role === 'player')).toBe(true);

			const { error: promotionError } = await service
				.from('profiles')
				.update({ role: 'admin' })
				.eq('user_id', admin.id);
			expect(promotionError).toBeNull();

			const { error: escalationError } = await player.client
				.from('profiles')
				.update({ role: 'admin' })
				.eq('user_id', player.id);
			expect(escalationError).not.toBeNull();

			const { data: unchangedPlayerProfile, error: unchangedPlayerProfileError } = await service
				.from('profiles')
				.select('role')
				.eq('user_id', player.id)
				.single();
			expect(unchangedPlayerProfileError).toBeNull();
			expect(unchangedPlayerProfile?.role).toBe('player');

			for (const actor of actors) {
				for (const target of actors) {
					const { data, error } = await actor.client
						.from('profiles')
						.update({ display_name: `${actor.name}-to-${target.name}` })
						.eq('user_id', target.id)
						.select('user_id');
					expect(error).toBeNull();
					expect(data?.map(({ user_id }) => user_id)).toEqual(
						actor.id === target.id ? [target.id] : []
					);
				}
			}

			const { error: playerCreateError } = await player.client
				.from('games')
				.insert({ name: `player-game-${suffix}` });
			expect(playerCreateError).not.toBeNull();

			const { data: game, error: adminCreateError } = await admin.client
				.from('games')
				.insert({ name: `admin-game-${suffix}`, created_by: admin.id })
				.select('game_id')
				.single();
			expect(adminCreateError).toBeNull();
			expect(game).not.toBeNull();
			gameId = game!.game_id;

			const { error: forgedGameOwnerError } = await admin.client.from('games').insert({
				name: `forged-owner-game-${suffix}`,
				created_by: player.id
			});
			expect(forgedGameOwnerError).not.toBeNull();

			const { data: tournament, error: tournamentError } = await admin.client
				.from('tournaments')
				.insert({
					game_id: gameId,
					name: `admin-tournament-${suffix}`,
					type: 'bracket',
					created_by: admin.id
				})
				.select('tournament_id')
				.single();
			expect(tournamentError).toBeNull();
			tournamentId = tournament!.tournament_id;

			const { error: forgedTournamentError } = await player.client.from('tournaments').insert({
				game_id: gameId,
				name: `forged-tournament-${suffix}`,
				type: 'bracket',
				created_by: admin.id
			});
			expect(forgedTournamentError).not.toBeNull();

			const { error: injectedParticipantError } = await player.client
				.from('tournament_participants')
				.insert({ tournament_id: tournamentId, user_id: player.id });
			expect(injectedParticipantError).not.toBeNull();

			const { error: participantError } = await admin.client
				.from('tournament_participants')
				.insert({ tournament_id: tournamentId, user_id: player.id });
			expect(participantError).toBeNull();

			const malformedClient = createClient<Database>(url, anonKey, {
				auth: { autoRefreshToken: false, persistSession: false },
				global: { headers: { Authorization: 'Bearer not-a-valid-jwt' } }
			});
			const { data: malformedData, error: malformedError } = await malformedClient
				.from('profiles')
				.update({ display_name: 'forged' })
				.eq('user_id', player.id)
				.select();
			expect(malformedError).not.toBeNull();
			expect(malformedData).toBeNull();

			const initialOtherData = {
				deviation: 350,
				lastRatedAt: '2026-07-25T00:00:00.000Z'
			};
			const { error: ratingsError } = await service.from('ratings').insert(
				users.map((userId) => ({
					game_id: gameId!,
					user_id: userId,
					rating: 1200,
					type: 'glicko',
					other_data: initialOtherData
				}))
			);
			expect(ratingsError).toBeNull();

			const rpcArgs = {
				p_game_id: gameId!,
				p_expected_configuration_revision: 1,
				p_loser_id: player.id,
				p_winner_id: admin.id,
				p_expected_loser_rating: 1200,
				p_expected_loser_type: 'glicko',
				p_expected_loser_other_data: initialOtherData,
				p_expected_winner_rating: 1200,
				p_expected_winner_type: 'glicko',
				p_expected_winner_other_data: initialOtherData,
				p_new_loser_rating: 1180,
				p_new_loser_other_data: {
					deviation: 340,
					lastRatedAt: '2026-07-25T01:00:00.000Z'
				},
				p_new_winner_rating: 1220,
				p_new_winner_other_data: {
					deviation: 340,
					lastRatedAt: '2026-07-25T01:00:00.000Z'
				},
				p_new_type: 'glicko'
			};

			const { error: publicRpcError } = await player.client.rpc('apply_rating_result', rpcArgs);
			expect(publicRpcError).not.toBeNull();

			const competingArgs = {
				...rpcArgs,
				p_new_loser_rating: 1170,
				p_new_loser_other_data: {
					deviation: 330,
					lastRatedAt: '2026-07-25T02:00:00.000Z'
				},
				p_new_winner_rating: 1230,
				p_new_winner_other_data: {
					deviation: 330,
					lastRatedAt: '2026-07-25T02:00:00.000Z'
				}
			};
			const concurrentResults = await Promise.all([
				service.rpc('apply_rating_result', rpcArgs),
				service.rpc('apply_rating_result', competingArgs)
			]);
			expect(concurrentResults.map(({ error }) => error)).toEqual([null, null]);
			expect(concurrentResults.map(({ data }) => data).sort()).toEqual([false, true]);

			const winningArgs = concurrentResults[0].data ? rpcArgs : competingArgs;
			const { data: finalRatings, error: finalError } = await service
				.from('ratings')
				.select('user_id, rating, type, other_data')
				.eq('game_id', gameId);
			expect(finalError).toBeNull();
			expect(finalRatings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						user_id: player.id,
						rating: winningArgs.p_new_loser_rating,
						type: winningArgs.p_new_type,
						other_data: winningArgs.p_new_loser_other_data
					}),
					expect.objectContaining({
						user_id: admin.id,
						rating: winningArgs.p_new_winner_rating,
						type: winningArgs.p_new_type,
						other_data: winningArgs.p_new_winner_other_data
					})
				])
			);

			const { error: revisionError } = await service
				.from('games')
				.update({ rating_configuration_revision: 2 })
				.eq('game_id', gameId);
			expect(revisionError).toBeNull();
			const { data: staleConfigurationApplied, error: staleConfigurationError } = await service.rpc(
				'apply_rating_result',
				{
					...rpcArgs,
					p_expected_loser_rating: winningArgs.p_new_loser_rating,
					p_expected_loser_other_data: winningArgs.p_new_loser_other_data,
					p_expected_winner_rating: winningArgs.p_new_winner_rating,
					p_expected_winner_other_data: winningArgs.p_new_winner_other_data
				}
			);
			expect(staleConfigurationError).toBeNull();
			expect(staleConfigurationApplied).toBe(false);
		} finally {
			if (tournamentId !== undefined) {
				await service.from('tournament_participants').delete().eq('tournament_id', tournamentId);
				await service.from('tournaments').delete().eq('tournament_id', tournamentId);
			}
			if (gameId !== undefined) {
				await service.from('games').delete().eq('game_id', gameId);
			}
			await Promise.all(users.map((id) => service.auth.admin.deleteUser(id)));
		}
	});
});
