import { redirect, fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';
import { parseRatingConfigurationForm, RatingConfigurationError } from '$lib/rating';

export const actions: Actions = {
	create: async ({ request, locals: { safeGetSession } }) => {
		const formData = await request.formData();
		const name = formData.get('gameName')?.toString().trim();
		const { user } = await safeGetSession();
		if (!user) {
			return fail(401, { configurationError: 'You must be signed in to create a game.' });
		}
		if (!name) return fail(400, { configurationError: 'Game name is required.' });
		let ratingConfiguration;
		try {
			ratingConfiguration = parseRatingConfigurationForm(formData);
		} catch (error) {
			return fail(400, {
				configurationError:
					error instanceof RatingConfigurationError
						? error.message
						: 'Invalid rating configuration.'
			});
		}
		// for some reason, we have to do this (bypass RLS)
		// XXX: eventually we need to make sure that only authenticated users
		// can insert or fix the RLS policies
		const { data, error } = await createClient<Database>(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY
		)
			.from('games')
			.insert([{ name, created_by: user.id, rating_configuration: ratingConfiguration }])
			.select();
		if (error != null) {
			return fail(400, { configurationError: error.message });
		}
		redirect(303, `/game/play/${data[0].game_id}`);
	}
};
