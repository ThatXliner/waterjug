import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseRatingConfigurationForm, RatingConfigurationError } from '$lib/rating';
import { requireRole } from '$lib/server/auth';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals, 'admin');
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireRole(locals, 'admin');
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
		const { data, error } = await locals.supabase
			.from('games')
			.insert([{ name, created_by: user.id, rating_configuration: ratingConfiguration }])
			.select('game_id')
			.single();
		if (error != null) {
			return fail(400, { configurationError: error.message });
		}
		redirect(303, `/game/play/${data.game_id}`);
	}
};
