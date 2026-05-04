import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const currentUserId = (await safeGetSession())?.user?.id;
	if (currentUserId == undefined) {
		error(401, 'no user');
	}
	const { data: ratings, error: err } = await supabase
		.from('ratings')
		.select('games (name), rating, game_id')
		.eq('user_id', currentUserId);
	if (err != null) {
		error(501, err);
	}
	const { data: profile } = await supabase
		.from('profiles')
		.select('display_name')
		.eq('user_id', currentUserId)
		.single();
	return { ratings, displayName: profile?.display_name ?? '' };
};

export const actions: Actions = {
	setDisplayName: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) error(401, 'no user');
		const formData = await request.formData();
		const displayName = formData.get('displayName')?.toString().trim();
		if (!displayName) {
			return fail(400, { error: 'Display name is required' });
		}
		const { error: err } = await supabase
			.from('profiles')
			.update({ display_name: displayName })
			.eq('user_id', user.id);
		if (err) {
			return fail(500, { error: err.message });
		}
		return { success: true };
	}
};
