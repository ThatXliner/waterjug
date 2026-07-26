import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { validateDisplayName } from '$lib/profile';
import { normalizeUsername, validateUsername } from '$lib/username';

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
		.select('display_name, username')
		.eq('user_id', currentUserId)
		.single();
	const { data: pendingReviews, error: pendingError } = await supabase
		.from('game_results')
		.select('game_id')
		.eq('status', 'pending')
		.neq('reporter_id', currentUserId);
	if (pendingError) {
		error(500, 'Pending result reviews could not be loaded.');
	}
	const pendingReviewCounts = (pendingReviews ?? []).reduce<Record<number, number>>(
		(counts, result) => {
			counts[result.game_id] = (counts[result.game_id] ?? 0) + 1;
			return counts;
		},
		{}
	);
	return {
		ratings,
		pendingReviewCounts,
		displayName: profile?.display_name ?? '',
		username: profile?.username ?? null,
		userId: currentUserId
	};
};

export const actions: Actions = {
	setUsername: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) error(401, 'no user');

		const formData = await request.formData();
		const username = normalizeUsername(formData.get('username')?.toString() ?? '');
		const validationError = validateUsername(username);
		if (validationError) {
			return fail(400, { usernameError: validationError, username });
		}

		const { error: updateError } = await supabase
			.from('profiles')
			.update({ username })
			.eq('user_id', user.id);

		if (updateError?.code === '23505') {
			return fail(409, { usernameError: 'That username is already taken.', username });
		}
		if (updateError) {
			return fail(500, {
				usernameError: 'Could not update your username. Please try again.',
				username
			});
		}

		return { usernameSuccess: true };
	},
	setDisplayName: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) error(401, 'no user');
		const formData = await request.formData();
		const result = validateDisplayName(formData.get('displayName'));
		if ('error' in result) {
			return fail(400, { error: result.error });
		}
		const { error: err } = await supabase
			.from('profiles')
			.update({ display_name: result.displayName })
			.eq('user_id', user.id);
		if (err) {
			return fail(500, { error: err.message });
		}
		return { success: true };
	}
};
