import { describe, expect, test } from 'vitest';
import {
	calculateRating,
	compileRatingFormula,
	DEFAULT_RATING_CONFIGURATION,
	parseRatingConfiguration,
	RatingConfigurationError
} from './rating';

describe('rating configuration', () => {
	test('fills defaults and returns a complete versioned model', () => {
		expect(parseRatingConfiguration({})).toEqual(DEFAULT_RATING_CONFIGURATION);
	});

	test('rejects invalid values with actionable field names', () => {
		expect(() =>
			parseRatingConfiguration({
				system: 'elo',
				defaultRating: -1,
				periodDays: 0,
				elo: { kFactor: 0 }
			})
		).toThrow(RatingConfigurationError);
		try {
			parseRatingConfiguration({ glicko: { initialDeviation: 400, maxDeviation: 300 } });
		} catch (error) {
			expect((error as Error).message).toContain('glicko.initialDeviation');
		}
	});

	test('rejects unsupported syntax instead of evaluating JavaScript', () => {
		expect(() => compileRatingFormula('globalThis.process.exit()')).toThrow('unsupported');
		expect(() => compileRatingFormula('constructor(1)')).toThrow('not supported');
		expect(() => compileRatingFormula('rating / 0')).toThrow('finite');
	});
});

describe('configured calculations', () => {
	test('uses configured Elo parameters', () => {
		const config = parseRatingConfiguration({ system: 'elo', elo: { kFactor: 40, scale: 200 } });
		expect(calculateRating(config, { rating: 1200 }, { rating: 1200 }, 1).rating).toBe(1220);
		expect(calculateRating(config, { rating: 1200 }, { rating: 1400 }, 1).rating).toBeCloseTo(
			1236.36,
			2
		);
	});

	test('uses the configured Glicko period at its boundary', () => {
		const now = new Date('2026-07-20T00:00:00.000Z');
		const config = parseRatingConfiguration({
			system: 'glicko',
			periodDays: 7,
			glicko: {
				initialDeviation: 100,
				maxDeviation: 350,
				periodDeviationIncrease: 50,
				scale: 400
			}
		});
		const before = calculateRating(
			config,
			{ rating: 1200, deviation: 100, lastRatedAt: '2026-07-13T00:00:01.000Z' },
			{ rating: 1200, deviation: 100 },
			1,
			now
		);
		const atBoundary = calculateRating(
			config,
			{ rating: 1200, deviation: 100, lastRatedAt: '2026-07-13T00:00:00.000Z' },
			{ rating: 1200, deviation: 100 },
			1,
			now
		);
		expect(atBoundary.rating).toBeGreaterThan(before.rating);
	});

	test('evaluates a custom formula for both wins and losses', () => {
		const config = parseRatingConfiguration({
			system: 'custom',
			custom: { formula: 'round(rating + 20 * (score - expected))' }
		});
		expect(calculateRating(config, { rating: 1200 }, { rating: 1200 }, 1).rating).toBe(1210);
		expect(calculateRating(config, { rating: 1200 }, { rating: 1200 }, 0).rating).toBe(1190);
	});
});
