import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';
import { SupabaseClient, createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';
import { getNewRating, defaultRD, type Player } from '$lib/glicko';
const DEFAULT_RATING = 1200;
async function fetchRatings(supabase: SupabaseClient<Database>, game_id: number) {
	const res = await supabase.from('ratings').select('rating, user_id').eq('game_id', game_id);
	const data = res.data;
	console.log(data, res.error);
	if (res.error != null) {
		throw res.error;
	}
	// Data can't be null if there's no error
	return data as NonNullable<typeof data>;
}
export const load: PageServerLoad = async ({ params, locals: { supabase } }) => {
	const { data: gameName, error: err } = await supabase
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
	if (data.filter((x) => x.user_id == user).length == 0) {
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

	return { data, gameName: gameName[0].name, user };
};

async function getRatingFor(supabase: SupabaseClient<Database>, user: string): Promise<Player> {
	const { data: ratings, error } = await supabase
		.from('ratings')
		.select('rating, other_data')
		.eq('user_id', user);
	console.log(ratings);
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
	default: async ({ request, locals: { getSession } }) => {
		const formData = await request.formData();
		const winner = formData.get('winner') as string;
		// XXX: Same RLS problem that I'm too lazy to resolve right now
		// update: maybe we don't need this anymore
		const supabaseServer = await createClient<Database>(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY
		);
		const user = (await getSession())?.user?.id;
		console.log(user);
		if (user == null) {
			throw new Error('No user');
		}
		const oldYou = await getRatingFor(supabaseServer, user);
		const oldThem = await getRatingFor(supabaseServer, winner);
		const newYou = getNewRating(oldYou, [oldThem], [0]);
		const newThem = getNewRating(oldThem, [oldYou], [1]);
		console.log('Before (looser):', oldYou, 'After:', newYou);
		console.log('Before (winner):', oldThem, 'After:', newThem);
		{
			const { data, error } = await supabaseServer
				.from('ratings')
				.update({ rating: newYou.rating, other_data: { rd: newYou.rd } })
				.eq('user_id', user)
				.select();
			if (error != null) throw error;
			console.log('Yu', data);
		}
		const { data, error } = await supabaseServer
			.from('ratings')
			.update({ rating: newThem.rating, other_data: { rd: newThem.rd } })
			.eq('user_id', winner)
			.select();
		if (error != null) throw error;
		console.log('them', data);
	}
};
