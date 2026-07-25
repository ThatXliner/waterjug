import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';
import {
	calculateRating,
	parseRatingConfiguration,
	parseRatingConfigurationForm,
	RatingConfigurationError,
	type RatingConfiguration,
	type RatingState
} from '$lib/rating';

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

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const gameId = parseInt(params.id);
	const { data: gameData, error: err } = await supabase
		.from('games')
		.select('name, created_by, rating_configuration')
		.eq('game_id', gameId)
		.single();
	if (err != null) {
		error(500, err);
	}
	let configuration: RatingConfiguration;
	try {
		configuration = parseRatingConfiguration(gameData.rating_configuration);
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
	const user = (await supabase.auth.getUser())?.data?.user?.id;
	if (!user) {
		error(401, 'No user');
	}
	if (data.filter((x: { user_id: string }) => x.user_id == user).length == 0) {
		await supabase.from('ratings').insert({
			game_id: gameId,
			user_id: user,
			rating: configuration.defaultRating,
			type: configuration.system,
			other_data: {
				deviation:
					configuration.system === 'glicko' ? configuration.glicko.initialDeviation : undefined,
				lastRatedAt: new Date().toISOString()
			}
		});
		data = await fetchRatings(supabase, gameId).catch((err) => {
			error(500, err);
		});
	}

	const userIds = data.map((r) => r.user_id);
	const { data: profiles } = await supabase
		.from('profiles')
		.select('user_id, display_name')
		.in('user_id', userIds);
	const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));

	const { data: tournaments } = await supabase
		.from('tournaments')
		.select('*')
		.eq('game_id', gameId)
		.order('created_at', { ascending: false });

	return {
		data,
		gameName: gameData.name,
		user,
		configuration,
		isOwner: gameData.created_by === user,
		profileMap: Object.fromEntries(profileMap),
		tournaments: tournaments ?? []
	};
};

async function getRatingFor(
	supabase: SupabaseClient<Database>,
	gameId: number,
	user: string,
	configuration: RatingConfiguration
): Promise<RatingState> {
	const { data: ratings, error } = await supabase
		.from('ratings')
		.select('rating, other_data')
		.eq('game_id', gameId)
		.eq('user_id', user);
	if (error != null) {
		throw error;
	}
	if (ratings.length != 1) {
		throw new Error('Impossible');
	}
	const fetched = ratings[0];
	const metadata = fetched.other_data as { deviation?: number; rd?: number; lastRatedAt?: string };
	return {
		rating: fetched.rating,
		deviation: metadata.deviation ?? metadata.rd ?? configuration.glicko.initialDeviation,
		lastRatedAt: metadata.lastRatedAt
	};
}

export const actions: Actions = {
	default: async ({ request, params, locals: { safeGetSession } }) => {
		const formData = await request.formData();
		const winner = formData.get('winner')?.toString();
		if (!winner) return fail(400, { ratingError: 'Select a winner.' });
		const supabaseServer = await createClient<Database>(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY
		);
		const { session } = await safeGetSession();
		const user = session?.user?.id;
		if (user == null) {
			throw new Error('No user');
		}
		if (winner === user) return fail(400, { ratingError: 'You cannot play against yourself.' });
		const gameId = parseInt(params.id);
		const { data: game, error: gameError } = await supabaseServer
			.from('games')
			.select('rating_configuration')
			.eq('game_id', gameId)
			.single();
		if (gameError) throw gameError;
		const configuration = parseRatingConfiguration(game.rating_configuration);
		const oldYou = await getRatingFor(supabaseServer, gameId, user, configuration);
		const oldThem = await getRatingFor(supabaseServer, gameId, winner, configuration);
		const now = new Date();
		const newYou = calculateRating(configuration, oldYou, oldThem, 0, now);
		const newThem = calculateRating(configuration, oldThem, oldYou, 1, now);
		{
			const { error } = await supabaseServer
				.from('ratings')
				.update({
					rating: newYou.rating,
					type: configuration.system,
					other_data: {
						deviation: newYou.deviation,
						lastRatedAt: newYou.lastRatedAt
					}
				})
				.eq('game_id', gameId)
				.eq('user_id', user)
				.select();
			if (error != null) throw error;
		}
		const { error } = await supabaseServer
			.from('ratings')
			.update({
				rating: newThem.rating,
				type: configuration.system,
				other_data: {
					deviation: newThem.deviation,
					lastRatedAt: newThem.lastRatedAt
				}
			})
			.eq('game_id', gameId)
			.eq('user_id', winner)
			.select();
		if (error != null) throw error;
	},

	createTournament: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) error(401, 'No user');

		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const type = formData.get('type')?.toString();
		const participants = formData.getAll('participants') as string[];

		if (!name) return fail(400, { tournamentError: 'Name is required' });
		if (!type || !['bracket', 'round_robin'].includes(type))
			return fail(400, { tournamentError: 'Invalid tournament type' });
		if (participants.length < 2)
			return fail(400, { tournamentError: 'Select at least 2 participants' });

		const gameId = parseInt(params.id);
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

	configure: async ({ request, params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) error(401, 'No user');
		const formData = await request.formData();
		let configuration;
		try {
			configuration = parseRatingConfigurationForm(formData);
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
		const { error: updateError } = await supabase
			.from('games')
			.update({ rating_configuration: configuration })
			.eq('game_id', parseInt(params.id));
		if (updateError) return fail(500, { configurationError: updateError.message });
		return { configurationSuccess: true };
	}
};
