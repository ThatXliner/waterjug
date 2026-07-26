import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
	calculateRating,
	createRatingCalculator,
	DEFAULT_RATING_CONFIGURATION,
	parseRatingConfiguration,
	RatingCalculationError,
	RatingConfigurationError,
	type RatingConfiguration
} from './rating';

const fuzzOptions = {
	seed: 0xe10,
	numRuns: 1_000,
	endOnFailure: true
} as const;

const calculationTime = new Date('2026-07-25T00:00:00.000Z');
const score = fc.constantFrom<0 | 0.5 | 1>(0, 0.5, 1);
const rating = fc.double({
	min: -1_000_000,
	max: 1_000_000,
	noNaN: true,
	noDefaultInfinity: true
});
const kFactor = fc.double({
	min: 0.01,
	max: 1000,
	noNaN: true,
	noDefaultInfinity: true
});
const scale = fc.double({
	min: 1,
	max: 10_000,
	noNaN: true,
	noDefaultInfinity: true
});
const eloConfiguration: fc.Arbitrary<RatingConfiguration> = fc
	.record({ kFactor, scale })
	.map((elo) => parseRatingConfiguration({ system: 'elo', elo }));

function ratingChange(
	configuration: RatingConfiguration,
	playerRating: number,
	opponentRating: number,
	playerScore: 0 | 0.5 | 1
) {
	return (
		calculateRating(
			configuration,
			{ rating: playerRating },
			{ rating: opponentRating },
			playerScore,
			calculationTime
		).rating - playerRating
	);
}

describe('Elo configuration properties', () => {
	test('rejects non-numeric persisted Elo parameters', () => {
		const nonNumericJson = fc.jsonValue().filter((value) => typeof value !== 'number');

		fc.assert(
			fc.property(
				nonNumericJson,
				fc.constantFrom<'kFactor' | 'scale'>('kFactor', 'scale'),
				(value, field) => {
					const elo = {
						...DEFAULT_RATING_CONFIGURATION.elo,
						[field]: value
					};
					expect(() => parseRatingConfiguration({ system: 'elo', elo })).toThrow(
						RatingConfigurationError
					);
				}
			),
			{ ...fuzzOptions, numRuns: 500 }
		);
	});

	test('matches the documented defaults when Elo parameters are omitted', () => {
		fc.assert(
			fc.property(rating, rating, score, (playerRating, opponentRating, playerScore) => {
				const implicit = parseRatingConfiguration({ system: 'elo' });
				const explicit = parseRatingConfiguration({
					system: 'elo',
					elo: DEFAULT_RATING_CONFIGURATION.elo
				});

				expect(
					calculateRating(
						implicit,
						{ rating: playerRating },
						{ rating: opponentRating },
						playerScore,
						calculationTime
					)
				).toEqual(
					calculateRating(
						explicit,
						{ rating: playerRating },
						{ rating: opponentRating },
						playerScore,
						calculationTime
					)
				);
			}),
			fuzzOptions
		);
	});
});

describe('configured Elo calculation properties', () => {
	test('is finite and deterministic throughout the supported arithmetic domain', () => {
		fc.assert(
			fc.property(
				eloConfiguration,
				rating,
				rating,
				score,
				(configuration, playerRating, opponentRating, playerScore) => {
					const calculator = createRatingCalculator(configuration);
					const first = calculator.calculateMatch(
						{ rating: playerRating },
						{ rating: opponentRating },
						playerScore,
						calculationTime
					);
					const second = calculator.calculateMatch(
						{ rating: playerRating },
						{ rating: opponentRating },
						playerScore,
						calculationTime
					);

					expect(first).toEqual(second);
					expect(Number.isFinite(first.player.rating)).toBe(true);
					expect(Number.isFinite(first.opponent.rating)).toBe(true);
					expect(first.player.rating + first.opponent.rating).toBeCloseTo(
						playerRating + opponentRating,
						7
					);
				}
			),
			fuzzOptions
		);
	});

	test('makes expected score monotonic in the player rating', () => {
		fc.assert(
			fc.property(
				eloConfiguration,
				rating,
				rating,
				rating,
				(configuration, firstRating, secondRating, opponentRating) => {
					const lowerRating = Math.min(firstRating, secondRating);
					const higherRating = Math.max(firstRating, secondRating);
					const lowerWinGain = ratingChange(configuration, lowerRating, opponentRating, 1);
					const higherWinGain = ratingChange(configuration, higherRating, opponentRating, 1);
					const tolerance =
						8 *
						Number.EPSILON *
						Math.max(1, Math.abs(lowerRating), Math.abs(higherRating), Math.abs(opponentRating));

					expect(lowerWinGain + tolerance).toBeGreaterThanOrEqual(higherWinGain);
				}
			),
			fuzzOptions
		);
	});

	test('uses rating scale to control confidence in rating gaps', () => {
		const gap = fc.double({
			min: 1,
			max: 1_000_000,
			noNaN: true,
			noDefaultInfinity: true
		});

		fc.assert(
			fc.property(
				kFactor,
				scale,
				scale,
				gap,
				(configuredKFactor, firstScale, secondScale, ratingGap) => {
					const smallerScale = Math.min(firstScale, secondScale);
					const largerScale = Math.max(firstScale, secondScale);
					const moreConfident = parseRatingConfiguration({
						system: 'elo',
						elo: { kFactor: configuredKFactor, scale: smallerScale }
					});
					const lessConfident = parseRatingConfiguration({
						system: 'elo',
						elo: { kFactor: configuredKFactor, scale: largerScale }
					});
					const favoriteWinWithMoreConfidence = ratingChange(moreConfident, ratingGap, 0, 1);
					const favoriteWinWithLessConfidence = ratingChange(lessConfident, ratingGap, 0, 1);
					const underdogWinWithMoreConfidence = ratingChange(moreConfident, -ratingGap, 0, 1);
					const underdogWinWithLessConfidence = ratingChange(lessConfident, -ratingGap, 0, 1);
					const tolerance = 1e-9;

					expect(favoriteWinWithMoreConfidence).toBeLessThanOrEqual(
						favoriteWinWithLessConfidence + tolerance
					);
					expect(underdogWinWithMoreConfidence + tolerance).toBeGreaterThanOrEqual(
						underdogWinWithLessConfidence
					);
				}
			),
			fuzzOptions
		);
	});

	test('is invariant when both ratings are translated by the same amount', () => {
		fc.assert(
			fc.property(
				eloConfiguration,
				rating,
				rating,
				rating,
				score,
				(configuration, playerRating, opponentRating, offset, playerScore) => {
					const originalChange = ratingChange(
						configuration,
						playerRating,
						opponentRating,
						playerScore
					);
					const translatedChange = ratingChange(
						configuration,
						playerRating + offset,
						opponentRating + offset,
						playerScore
					);

					expect(translatedChange).toBeCloseTo(originalChange, 7);
				}
			),
			fuzzOptions
		);
	});

	test('handles saturated rating gaps and fails closed at the persisted-state boundary', () => {
		const minimumScale = parseRatingConfiguration({
			system: 'elo',
			elo: { kFactor: 1000, scale: 1 }
		});
		const favorite = calculateRating(
			minimumScale,
			{ rating: 999_999_000 },
			{ rating: -1_000_000_000 },
			1,
			calculationTime
		);
		const underdog = calculateRating(
			minimumScale,
			{ rating: -999_999_000 },
			{ rating: 1_000_000_000 },
			1,
			calculationTime
		);

		expect(favorite.rating).toBe(999_999_000);
		expect(underdog.rating).toBe(-999_998_000);
		expect(() =>
			calculateRating(
				minimumScale,
				{ rating: 1_000_000_000 },
				{ rating: 1_000_000_000 },
				1,
				calculationTime
			)
		).toThrow(RatingCalculationError);
	});

	test('keeps equal-rating draws unchanged for every valid Elo configuration', () => {
		fc.assert(
			fc.property(eloConfiguration, rating, (configuration, equalRating) => {
				const result = createRatingCalculator(configuration).calculateMatch(
					{ rating: equalRating },
					{ rating: equalRating },
					0.5,
					calculationTime
				);
				const persistedRating = Object.is(equalRating, -0) ? 0 : equalRating;

				expect(result.player.rating).toBe(persistedRating);
				expect(result.opponent.rating).toBe(persistedRating);
			}),
			fuzzOptions
		);
	});
});
