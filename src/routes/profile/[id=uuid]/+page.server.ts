import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: profile, error: profileErr } = await supabase
		.from('profiles')
		.select('display_name, username, created_at')
		.eq('user_id', params.id)
		.single();

	if (profileErr || !profile) {
		error(404, 'Profile not found');
	}

	const { data: ratings } = await supabase
		.from('ratings')
		.select('rating, game_id, games (name)')
		.eq('user_id', params.id);

	const { data: tournamentParts } = await supabase
		.from('tournament_participants')
		.select('tournaments (tournament_id, name, type, status, game_id)')
		.eq('user_id', params.id);

	const tournaments = (tournamentParts ?? [])
		.map((t) => t.tournaments)
		.filter(Boolean)
		.flat();

	return {
		profile,
		ratings: ratings ?? [],
		tournaments
	};
};
