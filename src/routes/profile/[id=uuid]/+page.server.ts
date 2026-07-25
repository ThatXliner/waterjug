import { canUpdateProfile, validateDisplayName } from '$lib/profile';
import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals: { safeGetSession, supabase } }) => {
	const { user } = await safeGetSession();
	const { data: profile, error: profileErr } = await supabase
		.from('profiles')
		.select('display_name, username, created_at')
		.eq('user_id', params.id)
		.maybeSingle();

	if (profileErr) {
		error(500, 'Unable to load profile');
	}
	if (!profile) {
		error(404, 'Profile not found');
	}

	const { data: ratings, error: ratingsErr } = await supabase
		.from('ratings')
		.select('rating, game_id, games (name)')
		.eq('user_id', params.id)
		.order('rating', { ascending: false });

	if (ratingsErr) {
		error(500, 'Unable to load ratings');
	}

	const { data: tournamentParts, error: tournamentsErr } = await supabase
		.from('tournament_participants')
		.select('tournaments (tournament_id, name, type, status, game_id)')
		.eq('user_id', params.id);

	if (tournamentsErr) {
		error(500, 'Unable to load tournaments');
	}

	const tournaments = (tournamentParts ?? [])
		.map((t) => t.tournaments)
		.filter(Boolean)
		.flat();

	return {
		profile,
		ratings: ratings ?? [],
		tournaments,
		isOwner: canUpdateProfile(user?.id, params.id)
	};
};

export const actions: Actions = {
	updateProfile: async ({ params, request, locals: { safeGetSession, supabase } }) => {
		const { user } = await safeGetSession();

		if (!user) {
			error(401, 'Sign in to update your profile');
		}
		if (!canUpdateProfile(user.id, params.id)) {
			error(403, 'You can only update your own profile');
		}

		const formData = await request.formData();
		const result = validateDisplayName(formData.get('displayName'));
		if ('error' in result) {
			return fail(400, { updateError: result.error });
		}

		const { data: updatedProfile, error: updateErr } = await supabase
			.from('profiles')
			.update({ display_name: result.displayName })
			.eq('user_id', user.id)
			.select('display_name')
			.maybeSingle();

		if (updateErr) {
			return fail(500, { updateError: 'Unable to update profile' });
		}
		if (!updatedProfile) {
			error(404, 'Profile not found');
		}

		return { updateSuccess: true };
	}
};
