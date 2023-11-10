import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { IterableElement, SetNonNullable } from 'type-fest';

export const load: PageServerLoad = async ({ locals: { supabase, getSession } }) => {
	const currentUserId = (await getSession())?.user?.id;
	if (currentUserId == undefined) {
		throw error(401, 'no user');
	}
	const { data: ratings, error: err } = await supabase
		.from('ratings')
		.select('games (name), rating, game_id')
		.eq('user_id', currentUserId);
	if (err != null) {
		throw error(501, err);
	}
	return { ratings: ratings as SetNonNullable<IterableElement<typeof ratings>>[] };
};
