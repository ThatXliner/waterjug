import { redirect, fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';
import { parseRatingConfigurationForm, RatingConfigurationError } from '$lib/rating';
import { requireAuthenticatedUserId } from '$lib/server/auth';

export const actions: Actions = {
	create: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		const userId = requireAuthenticatedUserId(user);
		const formData = await request.formData();
		const name = formData.get('gameName')?.toString().trim();
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
		// Game creation currently uses the service role to bypass RLS, so the
		// authenticated boundary above must remain ahead of all privileged work.
		const { data, error } = await createClient<Database>(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY
		)
			.from('games')
			.insert([{ name, created_by: userId, rating_configuration: ratingConfiguration }])
			.select();
		if (error != null) {
			return fail(400, { configurationError: error.message });
		}
		redirect(303, `/game/play/${data[0].game_id}`);
	}
};
