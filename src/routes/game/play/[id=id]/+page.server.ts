import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase';
import { requireUser } from '$lib/server/auth';
import { getPrivilegedSupabase } from '$lib/server/supabase';
import { isUuid } from '$lib/uuid';
import {
	commitRatingConfiguration,
	createRatingCalculator,
	parseRatingConfiguration,
	parseRatingConfigurationForm,
	parseRatingConfigurationRevision,
	RatingConfigurationConflictError,
	RatingConfigurationError,
	type RatingConfiguration,
	type RatingState
} from '$lib/rating';

const MAX_RESULT_UPDATE_ATTEMPTS = 3;

async function requireGameAccess(supabase: SupabaseClient<Database>, gameId: number) {
	const { data: game, error: accessError } = await supabase
		.from('games')
		.select('name, invite_only, created_by, rating_configuration, rating_configuration_revision')
		.eq('game_id', gameId)
		.maybeSingle();

	if (accessError) {
		error(500, 'The game could not be loaded.');
	}
	if (game) {
		return game;
	}

	const { data: restrictedGame, error: lookupError } = await getPrivilegedSupabase()
		.from('games')
		.select('invite_only')
		.eq('game_id', gameId)
		.maybeSingle();
	if (lookupError) {
		error(500, 'The game could not be loaded.');
	}
	if (restrictedGame?.invite_only) {
		error(403, 'This game is invite-only. Ask the game creator to invite your account email.');
	}

	error(404, 'Game not found.');
}

async function fetchRatings(supabase: SupabaseClient<Database>, game_id: number) {
	const res = await supabase
		.from('ratings')
		.select('rating, user_id, other_data, type')
		.eq('game_id', game_id);
	const data = res.data;
	if (res.error != null) {
		throw res.error;
	}
	return data as NonNullable<typeof data>;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { supabase } = locals;
	const user = requireUser(locals).id;
	const gameId = parseInt(params.id);
	const game = await requireGameAccess(supabase, gameId);
	let configuration: RatingConfiguration;
	try {
		configuration = parseRatingConfiguration(game.rating_configuration);
	} catch (configurationError) {
		error(
			500,
			configurationError instanceof Error
				? configurationError.message
				: 'Invalid rating configuration'
		);
	}
	let data = await fetchRatings(supabase, gameId).catch((err) => {
		error(500, err);
	});
	if (!data.some((rating) => rating.user_id === user)) {
		const { error: joinError } = await supabase.rpc('ensure_game_rating', {
			p_game_id: gameId
		});
		if (joinError) {
			error(500, joinError);
		}
		data = await fetchRatings(supabase, gameId).catch((err) => {
			error(500, err);
		});
	}

	const userIds = data.map((r) => r.user_id);
	const { data: profiles } = await supabase
		.from('profiles')
		.select('user_id, display_name, username')
		.in('user_id', userIds);
	const profileMap = new Map(
		(profiles ?? []).map((profile) => [
			profile.user_id,
			profile.username ? `@${profile.username}` : profile.display_name
		])
	);

	const { data: tournaments } = await supabase
		.from('tournaments')
		.select('*')
		.eq('game_id', gameId)
		.order('created_at', { ascending: false });

	return {
		data,
		gameName: game.name,
		inviteOnly: game.invite_only,
		user,
		configuration,
		configurationRevision: game.rating_configuration_revision,
		isOwner: game.created_by === user,
		profileMap: Object.fromEntries(profileMap),
		tournaments: tournaments ?? []
	};
};

async function getRatingFor(
	supabase: SupabaseClient<Database>,
	gameId: number,
	user: string,
	configuration: RatingConfiguration
): Promise<{
	state: RatingState;
	type: string;
	otherData: Database['public']['Tables']['ratings']['Row']['other_data'];
}> {
	const { data: rating, error } = await supabase
		.from('ratings')
		.select('rating, other_data, type')
		.eq('game_id', gameId)
		.eq('user_id', user)
		.single();
	if (error != null) {
		throw error;
	}
	const metadata = rating.other_data as {
		deviation?: number;
		rd?: number;
		lastRatedAt?: string;
	};
	return {
		state: {
			rating: rating.rating,
			deviation: metadata.deviation ?? metadata.rd ?? configuration.glicko.initialDeviation,
			lastRatedAt: metadata.lastRatedAt
		},
		type: rating.type,
		otherData: rating.other_data
	};
}

export const actions: Actions = {
	rate: async ({ request, params, locals }) => {
		const user = requireUser(locals).id;
		const formData = await request.formData();
		const winner = formData.get('winner')?.toString();
		if (!isUuid(winner) || winner === user) {
			return fail(400, { resultError: 'Select another player as the winner' });
		}
		const gameId = parseInt(params.id);
		await requireGameAccess(locals.supabase, gameId);
		const privilegedSupabase = getPrivilegedSupabase();

		for (let attempt = 0; attempt < MAX_RESULT_UPDATE_ATTEMPTS; attempt += 1) {
			const { data: game, error: gameError } = await privilegedSupabase
				.from('games')
				.select('rating_configuration, rating_configuration_revision')
				.eq('game_id', gameId)
				.single();
			if (gameError) throw gameError;

			const configuration = parseRatingConfiguration(game.rating_configuration);
			const oldYou = await getRatingFor(privilegedSupabase, gameId, user, configuration);
			const oldThem = await getRatingFor(privilegedSupabase, gameId, winner, configuration);
			const match = createRatingCalculator(configuration).calculateMatch(
				oldYou.state,
				oldThem.state,
				0,
				new Date()
			);
			const loserOtherData = {
				deviation: match.player.deviation,
				lastRatedAt: match.player.lastRatedAt
			};
			const winnerOtherData = {
				deviation: match.opponent.deviation,
				lastRatedAt: match.opponent.lastRatedAt
			};
			const { data: applied, error: updateError } = await privilegedSupabase.rpc(
				'apply_rating_result',
				{
					p_game_id: gameId,
					p_expected_configuration_revision: game.rating_configuration_revision,
					p_loser_id: user,
					p_winner_id: winner,
					p_expected_loser_rating: oldYou.state.rating,
					p_expected_loser_type: oldYou.type,
					p_expected_loser_other_data: oldYou.otherData,
					p_expected_winner_rating: oldThem.state.rating,
					p_expected_winner_type: oldThem.type,
					p_expected_winner_other_data: oldThem.otherData,
					p_new_loser_rating: match.player.rating,
					p_new_loser_other_data: loserOtherData,
					p_new_winner_rating: match.opponent.rating,
					p_new_winner_other_data: winnerOtherData,
					p_new_type: configuration.system
				}
			);
			if (updateError) throw updateError;
			if (applied) return { resultSuccess: true };
		}

		error(409, 'Ratings or configuration changed concurrently; retry the result');
	},

	createTournament: async ({ request, params, locals }) => {
		const user = requireUser(locals);
		const { supabase } = locals;

		const gameId = parseInt(params.id);
		await requireGameAccess(supabase, gameId);
		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const type = formData.get('type')?.toString();
		const participants = formData.getAll('participants') as string[];

		if (!name) return fail(400, { tournamentError: 'Name is required' });
		if (!type || !['bracket', 'round_robin'].includes(type))
			return fail(400, { tournamentError: 'Invalid tournament type' });
		if (participants.length < 2)
			return fail(400, { tournamentError: 'Select at least 2 participants' });

		const { data: tournament, error: insertErr } = await supabase
			.from('tournaments')
			.insert({ game_id: gameId, name, type, created_by: user.id, status: 'pending' })
			.select('tournament_id')
			.single();

		if (insertErr) return fail(500, { tournamentError: insertErr.message });

		const participantRows = participants.map((userId) => ({
			tournament_id: tournament.tournament_id,
			user_id: userId
		}));
		const { error: partErr } = await supabase
			.from('tournament_participants')
			.insert(participantRows);

		if (partErr) return fail(500, { tournamentError: partErr.message });

		return { tournamentSuccess: true };
	},

	configure: async ({ request, params, locals }) => {
		const user = requireUser(locals);
		const { supabase } = locals;
		const formData = await request.formData();
		let configuration;
		let expectedRevision;
		try {
			configuration = parseRatingConfigurationForm(formData);
			expectedRevision = parseRatingConfigurationRevision(formData.get('configurationRevision'));
		} catch (configurationError) {
			return fail(400, {
				configurationError:
					configurationError instanceof RatingConfigurationError
						? configurationError.message
						: 'Invalid rating configuration.'
			});
		}
		const { data: existing, error: fetchError } = await supabase
			.from('games')
			.select('created_by')
			.eq('game_id', parseInt(params.id))
			.single();
		if (fetchError) return fail(500, { configurationError: fetchError.message });
		if (existing.created_by !== user.id)
			error(403, 'Only the game owner can change rating settings');
		try {
			await commitRatingConfiguration(
				{
					compareAndSet: async (currentRevision, nextRevision, nextConfiguration) => {
						const { data: updated, error: updateError } = await supabase
							.from('games')
							.update({
								rating_configuration: nextConfiguration,
								rating_configuration_revision: nextRevision
							})
							.eq('game_id', parseInt(params.id))
							.eq('rating_configuration_revision', currentRevision)
							.select('rating_configuration_revision')
							.maybeSingle();
						if (updateError) throw updateError;
						return updated !== null;
					}
				},
				expectedRevision,
				configuration
			);
		} catch (configurationError) {
			if (configurationError instanceof RatingConfigurationConflictError) {
				return fail(409, { configurationError: configurationError.message });
			}
			return fail(500, {
				configurationError:
					configurationError instanceof Error
						? configurationError.message
						: 'Could not update rating configuration.'
			});
		}
		return { configurationSuccess: true };
	}
};
