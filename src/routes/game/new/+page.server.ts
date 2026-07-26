import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseInviteEmails } from '$lib/invites';
import {
	parseRatingConfigurationForm,
	RatingConfigurationError,
	RatingFormulaError
} from '$lib/rating';
import { requireRole } from '$lib/server/auth';
import { preflightRatingFormulaIsolated } from '$lib/server/rating-formula-worker';

export const load: PageServerLoad = ({ locals }) => {
	requireRole(locals, 'admin');
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireRole(locals, 'admin');
		const formData = await request.formData();
		const name = formData.get('gameName')?.toString().trim() ?? '';
		const inviteOnly = formData.get('inviteOnly') === 'on';
		const invites = parseInviteEmails(formData.get('invitedEmails'));

		if (!name) {
			return fail(400, { message: 'Game name is required.', name, inviteOnly });
		}
		if (invites.error) {
			return fail(400, { message: invites.error, name, inviteOnly });
		}
		if (inviteOnly && invites.emails.length === 0) {
			return fail(400, {
				message: 'Add at least one email address for an invite-only game.',
				name,
				inviteOnly
			});
		}

		let ratingConfiguration;
		try {
			ratingConfiguration = parseRatingConfigurationForm(formData);
			if (ratingConfiguration.system === 'custom') {
				await preflightRatingFormulaIsolated(ratingConfiguration.custom.formula);
			}
		} catch (configurationError) {
			return fail(400, {
				configurationError:
					configurationError instanceof RatingConfigurationError
						? configurationError.message
						: configurationError instanceof RatingFormulaError
							? `custom.formula is invalid: ${configurationError.message}`
							: 'Invalid rating configuration.',
				name,
				inviteOnly
			});
		}
		const { data: gameId, error: createError } = await locals.supabase.rpc('create_game', {
			game_name: name,
			game_rating_configuration: ratingConfiguration,
			is_invite_only: inviteOnly,
			invited_emails: invites.emails
		});
		if (createError) {
			const message =
				createError.code === '23505'
					? 'A game with that name already exists.'
					: 'The game could not be created. Please try again.';
			return fail(400, { message, name, inviteOnly });
		}

		redirect(303, `/game/play/${gameId}`);
	}
};
