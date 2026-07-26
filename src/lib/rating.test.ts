import { describe, expect, test } from 'vitest';
import {
	calculateRating,
	calculateGlicko2RatingPeriod,
	compileRatingFormula,
	DEFAULT_RATING_CONFIGURATION,
	parseRatingConfiguration,
	parseRatingConfigurationForm,
	parseRatingConfigurationNumber,
	parseRatingPeriodDaysFormValue,
	RatingConfigurationError,
	RatingFormulaError,
	validateRatingFormula
} from './rating';

describe('rating configuration', () => {
	test('fills defaults and returns a complete versioned model', () => {
		expect(parseRatingConfiguration({})).toEqual(DEFAULT_RATING_CONFIGURATION);
	});

	test('rejects version 1 configurations', () => {
		expect(() => parseRatingConfiguration({ version: 1 })).toThrow('version must be 2');
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

	test('parses only bounded plain-decimal period form values', () => {
		expect(parseRatingPeriodDaysFormValue('0.0416667')).toBe(0.0416667);
		expect(parseRatingPeriodDaysFormValue('3650')).toBe(3650);
		for (const malformed of [
			null,
			'',
			' ',
			'0',
			'-1',
			'3650.1',
			'1e3',
			'+1',
			'0x10',
			'1 day',
			'2026-07-25T00:00:00.000Z',
			'2024-03-10T02:30:00-08:00'
		]) {
			expect(() => parseRatingPeriodDaysFormValue(malformed)).toThrow(RatingConfigurationError);
		}
	});

	test('rejects unsupported syntax instead of evaluating JavaScript', () => {
		expect(() => compileRatingFormula('globalThis.process.exit()')).toThrow('unsupported');
		expect(() => compileRatingFormula('constructor(1)')).toThrow('not supported');
		expect(() => compileRatingFormula('rating / 0')).toThrow('finite');
	});
	test.each([
		'',
		' ',
		'0x10',
		'1_200',
		'１２00',
		'1200\u0000',
		'Infinity',
		'-Infinity',
		'NaN',
		String(Number.MAX_VALUE),
		'9'.repeat(10_000)
	])('rejects malformed or out-of-range default-rating form value %j', (defaultRating) => {
		const parsed = parseRatingConfigurationNumber(defaultRating);
		expect(() => parseRatingConfiguration({ defaultRating: parsed })).toThrow(
			RatingConfigurationError
		);
	});

	test('does not coerce a missing default rating to zero', () => {
		const formData = new FormData();
		formData.set('system', 'glicko');
		formData.set('periodDays', '1');
		formData.set('glickoInitialDeviation', '350');
		formData.set('glickoMaxDeviation', '350');
		formData.set('glickoInitialVolatility', '0.06');
		formData.set('glickoTau', '0.5');
		formData.set('eloKFactor', '32');
		formData.set('eloScale', '400');
		formData.set('customFormula', DEFAULT_RATING_CONFIGURATION.custom.formula);

		expect(() => parseRatingConfigurationForm(formData)).toThrow(RatingConfigurationError);
	});

	test('parses Glicko-2 form controls into a version 2 configuration', () => {
		const formData = new FormData();
		formData.set('system', 'glicko');
		formData.set('defaultRating', '1500');
		formData.set('periodDays', '7');
		formData.set('glickoInitialDeviation', '200');
		formData.set('glickoMaxDeviation', '350');
		formData.set('glickoInitialVolatility', '0.06');
		formData.set('glickoTau', '0.5');
		formData.set('eloKFactor', '32');
		formData.set('eloScale', '400');
		formData.set('customFormula', DEFAULT_RATING_CONFIGURATION.custom.formula);

		expect(parseRatingConfigurationForm(formData)).toMatchObject({
			version: 2,
			system: 'glicko',
			defaultRating: 1500,
			periodDays: 7,
			glicko: {
				initialDeviation: 200,
				maxDeviation: 350,
				initialVolatility: 0.06,
				tau: 0.5
			}
		});
	});

	test('rejects resource exhaustion and invalid arity with located formula errors', () => {
		for (const formula of [
			`${'('.repeat(33)}rating${')'.repeat(33)}`,
			Array.from({ length: 101 }, () => '1').join('+'),
			'pow(2)',
			'abs(1, 2)',
			'1e309'
		]) {
			try {
				validateRatingFormula(formula);
				throw new Error(`formula unexpectedly validated: ${formula}`);
			} catch (error) {
				expect(error).toBeInstanceOf(RatingFormulaError);
				expect((error as Error).message.length).toBeGreaterThan(8);
			}
		}
		expect(() => validateRatingFormula('pow(2)')).toThrow('expects 2 arguments');
		expect(() => validateRatingFormula('rating.member')).toThrow('character 7');
	});
});

describe('configured calculations', () => {
	test('matches the official Glicko-2 reference rating period', () => {
		const result = calculateGlicko2RatingPeriod(
			parseRatingConfiguration({
				system: 'glicko',
				defaultRating: 1500,
				glicko: {
					initialDeviation: 350,
					maxDeviation: 1000,
					initialVolatility: 0.06,
					tau: 0.5
				}
			}),
			{ rating: 1500, deviation: 200, volatility: 0.06 },
			[
				{ rating: 1400, deviation: 30, score: 1 },
				{ rating: 1550, deviation: 100, score: 0 },
				{ rating: 1700, deviation: 300, score: 0 }
			]
		);
		expect(result.rating).toBeCloseTo(1464.06, 1);
		expect(result.deviation).toBeCloseTo(151.52, 1);
		expect(result.volatility).toBeCloseTo(0.05999, 4);
	});

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
				initialVolatility: 0.06,
				tau: 0.5
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

	test('uses elapsed time across DST rather than local calendar-day changes', () => {
		const config = parseRatingConfiguration({
			system: 'glicko',
			periodDays: 1,
			glicko: {
				initialDeviation: 100,
				maxDeviation: 350,
				initialVolatility: 0.06,
				tau: 0.5
			}
		});
		const opponent = { rating: 1200, deviation: 100 };
		const state = (lastRatedAt?: string) => ({ rating: 1200, deviation: 100, lastRatedAt });
		const calculate = (lastRatedAt: string | undefined, now: string) =>
			calculateRating(config, state(lastRatedAt), opponent, 1, new Date(now));

		const noInactivePeriod = calculate(undefined, '2024-03-11T01:30:00-07:00');
		const springForward = calculate('2024-03-10T01:30:00-08:00', '2024-03-11T01:30:00-07:00');
		expect(springForward.rating).toBeCloseTo(noInactivePeriod.rating, 12);
		expect(springForward.deviation).toBeCloseTo(noInactivePeriod.deviation!, 12);

		const exactPeriod = calculate('2024-11-03T02:30:00-08:00', '2024-11-04T02:30:00-08:00');
		const fallBack = calculate('2024-11-03T01:30:00-07:00', '2024-11-04T01:30:00-08:00');
		expect(fallBack.rating).toBeCloseTo(exactPeriod.rating, 12);
		expect(fallBack.deviation).toBeCloseTo(exactPeriod.deviation!, 12);
	});

	test('evaluates a custom formula for both wins and losses', () => {
		const config = parseRatingConfiguration({
			system: 'custom',
			custom: { formula: 'round(rating + 20 * (score - expected))' }
		});
		expect(calculateRating(config, { rating: 1200 }, { rating: 1200 }, 1).rating).toBe(1210);
		expect(calculateRating(config, { rating: 1200 }, { rating: 1200 }, 0).rating).toBe(1190);
	});

	test('normalizes negative zero for stable JSON persistence', () => {
		const config = parseRatingConfiguration({
			system: 'custom',
			custom: { formula: 'round(rating)' }
		});
		const result = calculateRating(config, { rating: -Number.MIN_VALUE }, { rating: 0 }, 0.5);
		expect(Object.is(result.rating, -0)).toBe(false);
		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});

	test('never leaks beyond the configured Glicko deviation maximum', () => {
		const config = parseRatingConfiguration({
			system: 'glicko',
			periodDays: 1 / 24,
			glicko: {
				initialDeviation: 1,
				maxDeviation: 963,
				initialVolatility: 0.06,
				tau: 0.5
			}
		});
		const result = calculateRating(
			config,
			{
				rating: -36.009751762637265,
				deviation: 963,
				lastRatedAt: '2000-01-01T00:00:00.000Z'
			},
			{ rating: 0, deviation: 1 },
			0,
			new Date('2026-07-24T00:00:00.000Z')
		);
		expect(result.deviation).toBeLessThanOrEqual(963);
	});
});
