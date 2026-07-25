import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';
import { getNewRating, defaultRD, type Player } from '$lib/glicko';
const DEFAULT_RATING = 1200;

async function fetchRatings(supabase: SupabaseClient<Database>, game_id: number) {
	const res = await supabase.from('ratings').select('rating, user_id').eq('game_id', game_id);
	const data = res.data;
	if (res.error != null) {
		throw res.error;
	}
	return data as NonNullable<typeof data>;
}

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: gameData, error: err } = await supabase
		.from('games')
		.select('name')
		.eq('game_id', parseInt(params.id));
	if (err != null) {
		error(500, err);
	}
	let data = await fetchRatings(supabase, parseInt(params.id)).catch((err) => {
		error(500, err);
	});
	const user = (await supabase.auth.getUser())?.data?.user?.id;
	if (!user) {
		error(401, 'No user');
	}
	if (data.filter((x: { user_id: string }) => x.user_id == user).length == 0) {
		await supabase.from('ratings').insert({
			game_id: parseInt(params.id),
			user_id: user,
			rating: DEFAULT_RATING,
			other_data: { rd: defaultRD }
		});
		data = await fetchRatings(supabase, parseInt(params.id)).catch((err) => {
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
		.eq('game_id', parseInt(params.id))
		.order('created_at', { ascending: false });

	return {
		data,
		gameName: gameData[0].name,
		user,
		profileMap: Object.fromEntries(profileMap),
		tournaments: tournaments ?? []
	};
};

async function getRatingFor(supabase: SupabaseClient<Database>, user: string): Promise<Player> {
	const { data: ratings, error } = await supabase
		.from('ratings')
		.select('rating, other_data')
		.eq('user_id', user);
	if (error != null) {
		throw error;
	}
	if (ratings.length != 1) {
		throw new Error('Impossible');
	}
	const fetched = ratings[0];
	const you = {
		rating: fetched.rating,
		rd: (fetched.other_data as { rd: number }).rd ?? defaultRD
	};
	return you;
}

export const actions: Actions = {
	default: async ({ request, locals: { safeGetSession } }) => {
		const formData = await request.formData();
		const winner = formData.get('winner') as string;
		const supabaseServer = await createClient<Database>(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY
		);
		const { session } = await safeGetSession();
		const user = session?.user?.id;
		if (user == null) {
			throw new Error('No user');
		}
		const oldYou = await getRatingFor(supabaseServer, user);
		const oldThem = await getRatingFor(supabaseServer, winner);
		const newYou = getNewRating(oldYou, [oldThem], [0]);
		const newThem = getNewRating(oldThem, [oldYou], [1]);
		{
			const { data, error } = await supabaseServer
				.from('ratings')
				.update({ rating: newYou.rating, other_data: { rd: newYou.rd } })
				.eq('user_id', user)
				.select();
			if (error != null) throw error;
		}
		const { data, error } = await supabaseServer
			.from('ratings')
			.update({ rating: newThem.rating, other_data: { rd: newThem.rd } })
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
	}
};
