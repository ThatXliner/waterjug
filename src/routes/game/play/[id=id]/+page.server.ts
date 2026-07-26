import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/supabase';
import { requireUser } from '$lib/server/auth';
import { getPrivilegedSupabase } from '$lib/server/supabase';
import { isUuid } from '$lib/uuid';
import {
	commitRatingConfiguration,
	calculateRatingMatchWithFormulaEvaluator,
	parseRatingConfiguration,
	parseRatingConfigurationForm,
	parseRatingConfigurationRevision,
	RatingConfigurationConflictError,
	RatingConfigurationError,
	RatingFormulaError,
	type RatingConfiguration,
	type RatingState
} from '$lib/rating';
import {
	evaluateRatingFormulaIsolated,
	preflightRatingFormulaIsolated
} from '$lib/server/rating-formula-worker';

async function requireGameAccess(supabase: SupabaseClient<Database>, gameId: number) {
	const { data: game, error: accessError } = await supabase
		.from('games')
		.select('name, invite_only, created_by, rating_configuration, rating_configuration_revision')
		.eq('game_id', gameId)
		.maybeSingle();

	if (accessError) {
		error(500, 'The game could not be loaded.');
	}
	if (game) {
		return game;
	}

	const { data: restrictedGame, error: lookupError } = await getPrivilegedSupabase()
		.from('games')
		.select('invite_only')
		.eq('game_id', gameId)
		.maybeSingle();
	if (lookupError) {
		error(500, 'The game could not be loaded.');
	}
	if (restrictedGame?.invite_only) {
		error(403, 'This game is invite-only. Ask the game creator to invite your account email.');
	}

	error(404, 'Game not found.');
}

async function fetchRatings(supabase: SupabaseClient<Database>, game_id: number) {
	const res = await supabase
		.from('ratings')
		.select('rating, user_id, other_data, type')
		.eq('game_id', game_id);
	const data = res.data;
	if (res.error != null) {
		throw res.error;
	}
	return data as NonNullable<typeof data>;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { supabase } = locals;
	const user = requireUser(locals).id;
	const gameId = parseInt(params.id);
	const game = await requireGameAccess(supabase, gameId);
	let configuration: RatingConfiguration;
	try {
		configuration = parseRatingConfiguration(game.rating_configuration);
	} catch (configurationError) {
		error(
			500,
			configurationError instanceof Error
				? configurationError.message
				: 'Invalid rating configuration'
		);
	}
	let data = await fetchRatings(supabase, gameId).catch((err) => {
		error(500, err);
	});
	if (!data.some((rating) => rating.user_id === user)) {
		const { error: joinError } = await supabase.rpc('ensure_game_rating', {
			p_game_id: gameId
		});
		if (joinError) {
			if (joinError.code === '42501') {
				error(403, 'This game is invite-only. Ask the game creator to invite your account email.');
			}
			error(500, joinError);
		}
		data = await fetchRatings(supabase, gameId).catch((err) => {
			error(500, err);
		});
	}

	const userIds = data.map((r) => r.user_id);
	const { data: profiles } = await supabase
		.from('profiles')
		.select('user_id, display_name, username')
		.in('user_id', userIds);
	const profileMap = new Map(
		(profiles ?? []).map((profile) => [
			profile.user_id,
			profile.username ? `@${profile.username}` : profile.display_name
		])
	);

	const { data: tournaments } = await supabase
		.from('tournaments')
		.select('*')
		.eq('game_id', gameId)
		.order('created_at', { ascending: false });

	const { data: results, error: resultsError } = await supabase
		.from('game_results')
		.select(
			'id, reporter_id, winner_id, loser_id, status, configuration_revision, winner_rating_snapshot, winner_type_snapshot, winner_other_data_snapshot, loser_rating_snapshot, loser_type_snapshot, loser_other_data_snapshot, reviewed_by, reviewed_at, created_at'
		)
		.eq('game_id', gameId)
		.order('created_at', { ascending: false });
	if (resultsError) {
		error(500, 'Game results could not be loaded.');
	}

	return {
		data,
		results,
		gameName: game.name,
		inviteOnly: game.invite_only,
		user,
		configuration,
		configurationRevision: game.rating_configuration_revision,
		isOwner: game.created_by === user,
		profileMap: Object.fromEntries(profileMap),
		tournaments: tournaments ?? []
	};
};

function ratingStateFromSnapshot(
	rating: number,
	otherData: unknown,
	configuration: RatingConfiguration
): RatingState {
	const metadata = otherData as {
		deviation?: number;
		rd?: number;
		lastRatedAt?: string;
	};
	return {
		rating,
		deviation: metadata.deviation ?? metadata.rd ?? configuration.glicko.initialDeviation,
		lastRatedAt: metadata.lastRatedAt
	};
}

export const actions: Actions = {
	reportResult: async ({ request, params, locals }) => {
		const user = requireUser(locals).id;
		const formData = await request.formData();
		const opponent = formData.get('opponent')?.toString();
		const outcome = formData.get('outcome')?.toString();
		const submissionId = formData.get('submissionId')?.toString();
		if (!isUuid(opponent) || opponent === user) {
			return fail(400, { resultError: 'Select another player as your opponent' });
		}
		if (!['won', 'lost'].includes(outcome ?? '')) {
			return fail(400, { resultError: 'Select whether you won or lost' });
		}
		if (!isUuid(submissionId)) {
			return fail(400, { resultError: 'Invalid result submission; reopen the form and retry' });
		}
		const gameId = parseInt(params.id);
		await requireGameAccess(locals.supabase, gameId);
		const winner = outcome === 'won' ? user : opponent;
		const loser = outcome === 'lost' ? user : opponent;
		const { error: insertError } = await locals.supabase.from('game_results').insert({
			game_id: gameId,
			reporter_id: user,
			submission_id: submissionId,
			winner_id: winner,
			loser_id: loser
		});
		if (insertError && insertError.code !== '23505') {
			if (insertError.code === '42501' || insertError.code === '23503') {
				return fail(403, {
					resultError: 'You and your opponent must both be current players in this game'
				});
			}
			return fail(500, { resultError: insertError.message });
		}

		return { resultSuccess: true };
	},

	reviewResult: async ({ request, params, locals }) => {
		const reviewerId = requireUser(locals).id;
		const formData = await request.formData();
		const resultId = Number(formData.get('resultId'));
		const decision = formData.get('decision')?.toString();
		if (!Number.isSafeInteger(resultId) || resultId <= 0) {
			return fail(400, { reviewError: 'Invalid result' });
		}
		if (decision !== 'confirmed' && decision !== 'disputed') {
			return fail(400, { reviewError: 'Choose confirm or dispute' });
		}

		const gameId = parseInt(params.id);
		await requireGameAccess(locals.supabase, gameId);
		const { data: result, error: resultError } = await locals.supabase
			.from('game_results')
			.select('*')
			.eq('id', resultId)
			.eq('game_id', gameId)
			.maybeSingle();
		if (resultError) return fail(500, { reviewError: resultError.message });
		if (!result) return fail(404, { reviewError: 'Result not found' });
		if (
			reviewerId === result.reporter_id ||
			(reviewerId !== result.winner_id && reviewerId !== result.loser_id)
		) {
			return fail(403, { reviewError: 'Only the opponent can review this result' });
		}

		let winnerNewRating: number | null = null;
		let winnerNewType: string | null = null;
		let winnerNewOtherData: { deviation?: number; lastRatedAt?: string } | null = null;
		let loserNewRating: number | null = null;
		let loserNewType: string | null = null;
		let loserNewOtherData: { deviation?: number; lastRatedAt?: string } | null = null;

		if (decision === 'confirmed') {
			const configuration = parseRatingConfiguration(result.rating_configuration_snapshot);
			const match = await calculateRatingMatchWithFormulaEvaluator(
				configuration,
				ratingStateFromSnapshot(
					result.winner_rating_snapshot,
					result.winner_other_data_snapshot,
					configuration
				),
				ratingStateFromSnapshot(
					result.loser_rating_snapshot,
					result.loser_other_data_snapshot,
					configuration
				),
				1,
				evaluateRatingFormulaIsolated,
				new Date()
			);
			winnerNewRating = match.player.rating;
			winnerNewType = configuration.system;
			winnerNewOtherData = {
				deviation: match.player.deviation,
				lastRatedAt: match.player.lastRatedAt
			};
			loserNewRating = match.opponent.rating;
			loserNewType = configuration.system;
			loserNewOtherData = {
				deviation: match.opponent.deviation,
				lastRatedAt: match.opponent.lastRatedAt
			};
		}

		const ratingUpdates =
			decision === 'confirmed'
				? {
						p_winner_new_rating: winnerNewRating!,
						p_winner_new_type: winnerNewType!,
						p_winner_new_other_data: winnerNewOtherData!,
						p_loser_new_rating: loserNewRating!,
						p_loser_new_type: loserNewType!,
						p_loser_new_other_data: loserNewOtherData!
					}
				: {};
		const privilegedSupabase = getPrivilegedSupabase();
		const { error: reviewError } = await privilegedSupabase.rpc('review_game_result', {
			p_result_id: result.id,
			p_reviewer_id: reviewerId,
			p_decision: decision,
			p_expected_configuration_revision: result.configuration_revision,
			...ratingUpdates
		});
		if (reviewError) {
			if (reviewError.code === 'PT409') {
				return fail(409, {
					reviewError:
						'Ratings or settings changed since this result was reported. Dispute it and report a fresh result.'
				});
			}
			if (reviewError.code === '42501') {
				return fail(403, { reviewError: 'You no longer have permission to review this result' });
			}
			if (reviewError.code === '22023') {
				return fail(409, { reviewError: reviewError.message });
			}
			return fail(500, { reviewError: reviewError.message });
		}

		return { reviewSuccess: true };
	},

	createTournament: async ({ request, params, locals }) => {
		const user = requireUser(locals);
		const { supabase } = locals;

		const gameId = parseInt(params.id);
		await requireGameAccess(supabase, gameId);
		const formData = await request.formData();
		const name = formData.get('name')?.toString().trim();
		const type = formData.get('type')?.toString();
		const participants = formData.getAll('participants') as string[];

		if (!name) return fail(400, { tournamentError: 'Name is required' });
		if (!type || !['bracket', 'round_robin'].includes(type))
			return fail(400, { tournamentError: 'Invalid tournament type' });
		if (participants.length < 2)
			return fail(400, { tournamentError: 'Select at least 2 participants' });

		const { data: tournament, error: insertErr } = await supabase
			.from('tournaments')
			.insert({ game_id: gameId, name, type, created_by: user.id, status: 'pending' })
			.select('tournament_id')
			.single();

		if (insertErr) return fail(500, { tournamentError: insertErr.message });

		const participantRows = participants.map((userId) => ({
			tournament_id: tournament.tournament_id,
			user_id: userId
		}));
		const { error: partErr } = await supabase
			.from('tournament_participants')
			.insert(participantRows);

		if (partErr) return fail(500, { tournamentError: partErr.message });

		return { tournamentSuccess: true };
	},

	configure: async ({ request, params, locals }) => {
		const user = requireUser(locals);
		const { supabase } = locals;
		const gameId = parseInt(params.id);
		await requireGameAccess(supabase, gameId);
		const formData = await request.formData();
		let configuration;
		let expectedRevision;
		try {
			configuration = parseRatingConfigurationForm(formData);
			expectedRevision = parseRatingConfigurationRevision(formData.get('configurationRevision'));
			if (configuration.system === 'custom') {
				await preflightRatingFormulaIsolated(configuration.custom.formula);
			}
		} catch (configurationError) {
			return fail(400, {
				configurationError:
					configurationError instanceof RatingConfigurationError
						? configurationError.message
						: configurationError instanceof RatingFormulaError
							? `custom.formula is invalid: ${configurationError.message}`
							: 'Invalid rating configuration.'
			});
		}
		const { data: existing, error: fetchError } = await supabase
			.from('games')
			.select('created_by')
			.eq('game_id', gameId)
			.single();
		if (fetchError) return fail(500, { configurationError: fetchError.message });
		if (existing.created_by !== user.id)
			error(403, 'Only the game owner can change rating settings');
		try {
			await commitRatingConfiguration(
				{
					compareAndSet: async (currentRevision, nextRevision, nextConfiguration) => {
						const { data: updated, error: updateError } = await supabase
							.from('games')
							.update({
								rating_configuration: nextConfiguration,
								rating_configuration_revision: nextRevision
							})
							.eq('game_id', gameId)
							.eq('rating_configuration_revision', currentRevision)
							.select('rating_configuration_revision')
							.maybeSingle();
						if (updateError) throw updateError;
						return updated !== null;
					}
				},
				expectedRevision,
				configuration
			);
		} catch (configurationError) {
			if (configurationError instanceof RatingConfigurationConflictError) {
				return fail(409, { configurationError: configurationError.message });
			}
			return fail(500, {
				configurationError:
					configurationError instanceof Error
						? configurationError.message
						: 'Could not update rating configuration.'
			});
		}
		return { configurationSuccess: true };
	}
};
