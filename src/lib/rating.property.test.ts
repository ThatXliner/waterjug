import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
	calculateRating,
	commitRatingConfiguration,
	compileRatingFormula,
	createRatingCalculator,
	DEFAULT_RATING_CONFIGURATION,
	nextRatingConfigurationRevision,
	parseRatingConfiguration,
	parseRatingConfigurationNumber,
	parseRatingConfigurationRevision,
	parseRatingPeriodDaysFormValue,
	RatingCalculationError,
	RatingConfigurationConflictError,
	RatingConfigurationError,
	type RatingConfiguration,
	type RatingState
} from './rating';

const supportedFormula = fc.constantFrom(
	'rating + 32 * (score - expected)',
	'rating + 10 * score - 5',
	'round(rating + 24 * (score - expected))',
	'max(-1000000, min(1000000, rating + 16 * (score - expected)))',
	'rating + abs(opponentRating - rating) * (score - expected) / 10'
);

const validConfiguration: fc.Arbitrary<RatingConfiguration> = fc
	.record({
		system: fc.constantFrom('glicko', 'elo', 'custom'),
		defaultRating: fc.double({
			min: 0,
			max: 1_000_000,
			noNaN: true,
			noDefaultInfinity: true
		}),
		periodDays: fc.double({
			min: 1 / 24,
			max: 3650,
			noNaN: true,
			noDefaultInfinity: true
		}),
		maxDeviation: fc.integer({ min: 1, max: 1000 }),
		initialVolatility: fc.double({
			min: 0.000001,
			max: 0.2,
			noNaN: true,
			noDefaultInfinity: true
		}),
		tau: fc.double({
			min: 0.3,
			max: 1.2,
			noNaN: true,
			noDefaultInfinity: true
		}),
		kFactor: fc.double({
			min: 0.01,
			max: 1000,
			noNaN: true,
			noDefaultInfinity: true
		}),
		eloScale: fc.double({
			min: 1,
			max: 10_000,
			noNaN: true,
			noDefaultInfinity: true
		}),
		formula: supportedFormula
	})
	.chain((values) =>
		fc
			.double({
				min: 1,
				max: values.maxDeviation,
				noNaN: true,
				noDefaultInfinity: true
			})
			.map((initialDeviation) =>
				parseRatingConfiguration({
					version: 2,
					system: values.system,
					defaultRating: values.defaultRating,
					periodDays: values.periodDays,
					glicko: {
						initialDeviation,
						maxDeviation: values.maxDeviation,
						initialVolatility: values.initialVolatility,
						tau: values.tau
					},
					elo: { kFactor: values.kFactor, scale: values.eloScale },
					custom: { formula: values.formula }
				})
			)
	);

const ratingState: fc.Arbitrary<RatingState> = fc.record({
	rating: fc.double({
		min: -1_000_000,
		max: 1_000_000,
		noNaN: true,
		noDefaultInfinity: true
	}),
	deviation: fc.double({
		min: 1,
		max: 1000,
		noNaN: true,
		noDefaultInfinity: true
	}),
	volatility: fc.double({
		min: 0.000001,
		max: 0.2,
		noNaN: true,
		noDefaultInfinity: true
	}),
	lastRatedAt: fc
		.date({
			min: new Date('2000-01-01T00:00:00.000Z'),
			max: new Date('2026-01-01T00:00:00.000Z'),
			noInvalidDate: true
		})
		.map((date) => date.toISOString())
});

const outcome = fc.constantFrom<0 | 0.5 | 1>(0, 0.5, 1);
const calculationTime = new Date('2026-07-24T00:00:00.000Z');

function formatWithOffset(date: Date, offsetMinutes: number) {
	const local = new Date(date.getTime() + offsetMinutes * 60_000);
	const sign = offsetMinutes < 0 ? '-' : '+';
	const absoluteOffset = Math.abs(offsetMinutes);
	const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
	const minutes = String(absoluteOffset % 60).padStart(2, '0');
	return `${local.toISOString().slice(0, -1)}${sign}${hours}:${minutes}`;
}

describe('rating configuration properties', () => {
	test('default-rating form values accept exactly finite in-range decimal syntax', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 200 }), (submitted) => {
				const normalized = submitted.trim();
				const decimalSyntax = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
				const numeric = Number(normalized);
				const parsed = parseRatingConfigurationNumber(submitted);

				if (!decimalSyntax.test(normalized) || !Number.isFinite(numeric)) {
					expect(Number.isNaN(parsed)).toBe(true);
				} else if (numeric < 0 || numeric > 1_000_000) {
					expect(parsed).toBe(numeric);
					expect(() => parseRatingConfiguration({ defaultRating: parsed })).toThrow(
						RatingConfigurationError
					);
				} else {
					expect(parsed).toBe(numeric);
					expect(parseRatingConfiguration({ defaultRating: parsed }).defaultRating).toBe(numeric);
				}
			}),
			{ numRuns: 10_000, seed: 0xa11ce }
		);
	});

	test('default-rating form parsing preserves arbitrary valid finite values', () => {
		fc.assert(
			fc.property(
				fc.double({
					min: 0,
					max: 1_000_000,
					noNaN: true,
					noDefaultInfinity: true
				}),
				(value) => {
					const parsed = parseRatingConfigurationNumber(String(value));
					expect(parsed).toBe(value);
					expect(parseRatingConfiguration({ defaultRating: parsed }).defaultRating).toBe(value);
				}
			),
			{ numRuns: 2_000, seed: 0x9d3f }
		);
	});

	test('valid configurations survive JSON persistence round trips', () => {
		fc.assert(
			fc.property(validConfiguration, (configuration) => {
				const persisted = JSON.parse(JSON.stringify(configuration));
				expect(parseRatingConfiguration(persisted)).toEqual(configuration);
			}),
			{ numRuns: 500 }
		);
	});

	test('all numeric fields reject NaN, infinity, and out-of-range values', () => {
		const invalidCases: Array<{
			path: string[];
			values: number[];
		}> = [
			{ path: ['defaultRating'], values: [NaN, Infinity, -Infinity, -1, 1_000_001] },
			{ path: ['periodDays'], values: [NaN, Infinity, -Infinity, 0, 3651] },
			{ path: ['glicko', 'initialDeviation'], values: [NaN, Infinity, -Infinity, 0, 1001] },
			{ path: ['glicko', 'maxDeviation'], values: [NaN, Infinity, -Infinity, 0, 1001] },
			{
				path: ['glicko', 'initialVolatility'],
				values: [NaN, Infinity, -Infinity, 0, 0.21]
			},
			{ path: ['glicko', 'tau'], values: [NaN, Infinity, -Infinity, 0.29, 1.21] },
			{ path: ['elo', 'kFactor'], values: [NaN, Infinity, -Infinity, 0, 1001] },
			{ path: ['elo', 'scale'], values: [NaN, Infinity, -Infinity, 0, 10_001] }
		];

		for (const { path, values } of invalidCases) {
			fc.assert(
				fc.property(fc.constantFrom(...values), (invalid) => {
					const candidate = structuredClone(DEFAULT_RATING_CONFIGURATION) as unknown as Record<
						string,
						unknown
					>;
					let target = candidate;
					for (const segment of path.slice(0, -1)) {
						target = target[segment] as Record<string, unknown>;
					}
					target[path.at(-1)!] = invalid;
					expect(() => parseRatingConfiguration(candidate)).toThrow(RatingConfigurationError);
				})
			);
		}
	});

	test('period form parsing accepts exactly bounded plain-decimal values', () => {
		fc.assert(
			fc.property(
				fc.double({
					min: 1 / 24,
					max: 3650,
					noNaN: true,
					noDefaultInfinity: true
				}),
				(periodDays) => {
					const decimal = periodDays.toString();
					fc.pre(!/[eE]/.test(decimal));
					expect(parseRatingPeriodDaysFormValue(decimal)).toBe(periodDays);
				}
			),
			{ numRuns: 1000 }
		);

		fc.assert(
			fc.property(fc.anything(), (value) => {
				const valid =
					typeof value === 'string' &&
					/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) &&
					Number.isFinite(Number(value.trim())) &&
					Number(value.trim()) >= 1 / 24 &&
					Number(value.trim()) <= 3650;
				fc.pre(!valid);
				expect(() => parseRatingPeriodDaysFormValue(value)).toThrow(RatingConfigurationError);
			}),
			{ numRuns: 1000 }
		);
	});

	test('revision values are monotonic safe integers and reject overflow', () => {
		fc.assert(
			fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER - 1 }), (revision) => {
				expect(parseRatingConfigurationRevision(String(revision))).toBe(revision);
				expect(nextRatingConfigurationRevision(revision)).toBe(revision + 1);
			}),
			{ numRuns: 500 }
		);
		for (const invalid of [
			0,
			-1,
			1.5,
			NaN,
			Infinity,
			Number.MAX_SAFE_INTEGER,
			'not-a-number',
			''
		]) {
			expect(() => parseRatingConfigurationRevision(invalid)).toThrow(RatingConfigurationError);
		}
	});

	test('concurrent writers cannot both commit the same configuration revision', async () => {
		await fc.assert(
			fc.asyncProperty(
				validConfiguration,
				validConfiguration,
				async (firstConfiguration, secondConfiguration) => {
					let persisted = {
						configuration: DEFAULT_RATING_CONFIGURATION,
						revision: 1
					};
					const store = {
						async compareAndSet(
							expectedRevision: number,
							nextRevision: number,
							configuration: RatingConfiguration
						) {
							await Promise.resolve();
							if (persisted.revision !== expectedRevision) return false;
							persisted = { configuration, revision: nextRevision };
							return true;
						}
					};
					const results = await Promise.allSettled([
						commitRatingConfiguration(store, 1, firstConfiguration),
						commitRatingConfiguration(store, 1, secondConfiguration)
					]);
					expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
					const rejected = results.find((result) => result.status === 'rejected');
					expect(rejected).toMatchObject({
						status: 'rejected',
						reason: expect.any(RatingConfigurationConflictError)
					});
					expect(persisted.revision).toBe(2);
					expect([firstConfiguration, secondConfiguration]).toContainEqual(persisted.configuration);
				}
			),
			{ numRuns: 500 }
		);
	});
});

describe('rating calculation properties', () => {
	test('Glicko inactivity rolls over exactly at generated period boundaries', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 3650 * 24 }),
				fc.integer({ min: 1, max: 20 }),
				(periodHours, completedPeriods) => {
					const periodMilliseconds = periodHours * 60 * 60 * 1000;
					const now = new Date('2030-01-01T00:00:00.000Z');
					const configuration = parseRatingConfiguration({
						system: 'glicko',
						periodDays: periodHours / 24,
						glicko: {
							initialDeviation: 50,
							maxDeviation: 1000,
							initialVolatility: 0.06,
							tau: 0.5
						}
					});
					const opponent = { rating: 1200, deviation: 100 };
					const resultAt = calculateRating(
						configuration,
						{
							rating: 1200,
							deviation: 50,
							lastRatedAt: new Date(
								now.getTime() - completedPeriods * periodMilliseconds
							).toISOString()
						},
						opponent,
						1,
						now
					);
					const resultBefore = calculateRating(
						configuration,
						{
							rating: 1200,
							deviation: 50,
							lastRatedAt: new Date(
								now.getTime() - completedPeriods * periodMilliseconds + 1
							).toISOString()
						},
						opponent,
						1,
						now
					);

					expect(resultAt.rating).toBeGreaterThan(resultBefore.rating);
					expect(resultAt.deviation).toBeGreaterThan(resultBefore.deviation!);
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('timezone representations of the same instants calculate identically', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 3650 * 24 }),
				fc.integer({ min: 0, max: 20 }),
				fc.integer({ min: -48, max: 56 }),
				(periodHours, completedPeriods, offsetQuarterHours) => {
					const now = new Date('2026-07-25T12:00:00.000Z');
					const lastRatedAt = new Date(
						now.getTime() - completedPeriods * periodHours * 60 * 60 * 1000
					);
					const configuration = parseRatingConfiguration({
						system: 'glicko',
						periodDays: periodHours / 24
					});
					const player = { rating: 1200, deviation: 100 };
					const opponent = { rating: 1200, deviation: 100 };
					const utc = calculateRating(
						configuration,
						{ ...player, lastRatedAt: lastRatedAt.toISOString() },
						opponent,
						1,
						now
					);
					const offset = calculateRating(
						configuration,
						{
							...player,
							lastRatedAt: formatWithOffset(lastRatedAt, offsetQuarterHours * 15)
						},
						opponent,
						1,
						now
					);

					expect(offset).toEqual(utc);
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('Glicko-2 remains stable for the minimum supported deviation', () => {
		const configuration = parseRatingConfiguration({
			system: 'glicko',
			glicko: {
				initialDeviation: 1,
				maxDeviation: 350,
				initialVolatility: 0.06,
				tau: 0.5
			}
		});
		const result = calculateRating(
			configuration,
			{ rating: 0, deviation: 1, volatility: 0.06 },
			{ rating: 0, deviation: 1 },
			0.5,
			calculationTime
		);

		expect(result.rating).toBe(0);
		expect(result.deviation).toBeGreaterThan(0);
	});

	test('Glicko-2 rating changes are monotonic across outcomes', () => {
		fc.assert(
			fc.property(
				validConfiguration,
				ratingState,
				ratingState,
				(configuration, player, opponent) => {
					const glicko = parseRatingConfiguration({ ...configuration, system: 'glicko' });
					const loss = calculateRating(glicko, player, opponent, 0, calculationTime);
					const draw = calculateRating(glicko, player, opponent, 0.5, calculationTime);
					const win = calculateRating(glicko, player, opponent, 1, calculationTime);

					expect(loss.rating).toBeLessThanOrEqual(draw.rating);
					expect(draw.rating).toBeLessThanOrEqual(win.rating);
					for (const result of [loss, draw, win]) {
						expect(result.deviation).toBeGreaterThan(0);
						expect(result.deviation).toBeLessThanOrEqual(glicko.glicko.maxDeviation);
						expect(result.volatility).toBeGreaterThan(0);
					}
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('more inactive Glicko periods cannot reduce the next update magnitude or deviation', () => {
		fc.assert(
			fc.property(
				validConfiguration,
				fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 1, max: 1000, noNaN: true, noDefaultInfinity: true }),
				outcome,
				(configuration, rating, deviation, score) => {
					const glicko = parseRatingConfiguration({
						...configuration,
						system: 'glicko',
						periodDays: 1,
						glicko: configuration.glicko
					});
					const opponent = { rating: rating + 100, deviation: 100 };
					const recent = calculateRating(
						glicko,
						{
							rating,
							deviation,
							lastRatedAt: '2026-07-23T23:59:59.000Z'
						},
						opponent,
						score,
						calculationTime
					);
					const inactive = calculateRating(
						glicko,
						{
							rating,
							deviation,
							lastRatedAt: '2025-07-24T00:00:00.000Z'
						},
						opponent,
						score,
						calculationTime
					);

					const recentChange = Math.abs(recent.rating - rating);
					const inactiveChange = Math.abs(inactive.rating - rating);
					const changeTolerance = Number.EPSILON * Math.max(1, recentChange, inactiveChange) * 16;
					const deviationTolerance =
						Number.EPSILON * Math.max(1, recent.deviation!, inactive.deviation!) * 16;

					expect(inactiveChange + changeTolerance).toBeGreaterThanOrEqual(recentChange);
					expect(inactive.deviation! + deviationTolerance).toBeGreaterThanOrEqual(
						recent.deviation!
					);
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('a large sequence of configured Glicko updates remains finite and deterministic', () => {
		const configuration = parseRatingConfiguration({
			system: 'glicko',
			glicko: {
				initialDeviation: 350,
				maxDeviation: 350,
				initialVolatility: 0.06,
				tau: 0.5
			}
		});
		const run = () => {
			let player: RatingState = { rating: 1200, deviation: 350 };
			for (let index = 0; index < 10_000; index += 1) {
				player = calculateRating(
					configuration,
					player,
					{ rating: 800 + (index % 1400), deviation: 1 + (index % 350) },
					[0, 0.5, 1][index % 3] as 0 | 0.5 | 1,
					calculationTime
				);
			}
			return player;
		};

		const first = run();
		expect(first).toEqual(run());
		expect(Number.isFinite(first.rating)).toBe(true);
		expect(Number.isFinite(first.deviation)).toBe(true);
		expect(first.deviation).toBeGreaterThan(0);
		expect(first.deviation).toBeLessThanOrEqual(configuration.glicko.maxDeviation);
	});

	test('valid calculations produce finite persisted states and advance time', () => {
		fc.assert(
			fc.property(
				validConfiguration,
				ratingState,
				ratingState,
				outcome,
				(configuration, player, opponent, score) => {
					const result = calculateRating(configuration, player, opponent, score, calculationTime);
					expect(Number.isFinite(result.rating)).toBe(true);
					expect(Math.abs(result.rating)).toBeLessThanOrEqual(1_000_000_000);
					expect(result.lastRatedAt).toBe(calculationTime.toISOString());
					if (configuration.system === 'glicko') {
						expect(result.deviation).toBeGreaterThan(0);
						expect(result.deviation).toBeLessThanOrEqual(configuration.glicko.maxDeviation);
					}
					expect(JSON.parse(JSON.stringify(result))).toEqual(result);
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('Elo matches conserve the combined rating', () => {
		fc.assert(
			fc.property(
				validConfiguration,
				ratingState,
				ratingState,
				outcome,
				(configuration, player, opponent, score) => {
					const elo = parseRatingConfiguration({ ...configuration, system: 'elo' });
					const result = createRatingCalculator(elo).calculateMatch(
						player,
						opponent,
						score,
						calculationTime
					);
					expect(result.player.rating + result.opponent.rating).toBeCloseTo(
						player.rating + opponent.rating,
						7
					);
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('symmetric Glicko states have symmetric rating and deviation transitions', () => {
		fc.assert(
			fc.property(
				validConfiguration,
				fc.double({
					min: -1_000_000,
					max: 1_000_000,
					noNaN: true,
					noDefaultInfinity: true
				}),
				fc.double({
					min: 1,
					max: 1000,
					noNaN: true,
					noDefaultInfinity: true
				}),
				outcome,
				(configuration, rating, deviation, score) => {
					const glicko = parseRatingConfiguration({
						...configuration,
						system: 'glicko',
						glicko: {
							...configuration.glicko,
							initialDeviation: Math.min(
								configuration.glicko.initialDeviation,
								configuration.glicko.maxDeviation
							)
						}
					});
					const state = {
						rating,
						deviation,
						lastRatedAt: '2026-01-01T00:00:00.000Z'
					};
					const result = createRatingCalculator(glicko).calculateMatch(
						state,
						state,
						score,
						calculationTime
					);
					expect(result.player.rating + result.opponent.rating).toBeCloseTo(2 * rating, 7);
					expect(result.player.deviation).toBeCloseTo(result.opponent.deviation!, 10);
				}
			),
			{ numRuns: 500 }
		);
	});

	test('calculators retain one configuration snapshot across concurrent changes', () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.01, max: 499, noNaN: true, noDefaultInfinity: true }),
				fc.double({ min: 500, max: 1000, noNaN: true, noDefaultInfinity: true }),
				(firstKFactor, secondKFactor) => {
					const mutable = parseRatingConfiguration({
						system: 'elo',
						elo: { kFactor: firstKFactor, scale: 400 }
					});
					const inFlight = createRatingCalculator(mutable);
					mutable.elo.kFactor = secondKFactor;
					const afterUpdate = createRatingCalculator(mutable);
					const player = { rating: 1200 };
					const opponent = { rating: 1200 };
					expect(
						inFlight.calculateMatch(player, opponent, 1, calculationTime).player.rating
					).toBeCloseTo(1200 + firstKFactor / 2, 10);
					expect(
						afterUpdate.calculateMatch(player, opponent, 1, calculationTime).player.rating
					).toBeCloseTo(1200 + secondKFactor / 2, 10);
				}
			),
			{ numRuns: 500 }
		);
	});

	test('invalid state, score, time, and overflowing results fail closed', () => {
		const config = parseRatingConfiguration({ system: 'elo' });
		const invalidNumber = fc.constantFrom(NaN, Infinity, -Infinity);
		fc.assert(
			fc.property(invalidNumber, (invalid) => {
				expect(() =>
					calculateRating(config, { rating: invalid }, { rating: 1200 }, 1, calculationTime)
				).toThrow(RatingCalculationError);
				expect(() =>
					calculateRating(
						config,
						{ rating: 1200, deviation: invalid },
						{ rating: 1200 },
						1,
						calculationTime
					)
				).toThrow(RatingCalculationError);
			})
		);
		expect(() =>
			calculateRating(
				config,
				{ rating: 1200, lastRatedAt: 'not-a-date' },
				{ rating: 1200 },
				1,
				calculationTime
			)
		).toThrow(RatingCalculationError);
		expect(() =>
			calculateRating(config, { rating: 1200 }, { rating: 1200 }, 0.25 as 0.5, calculationTime)
		).toThrow(RatingCalculationError);
		expect(() =>
			calculateRating(config, { rating: 1200 }, { rating: 1200 }, 1, new Date(NaN))
		).toThrow(RatingCalculationError);
		const overflowing = parseRatingConfiguration({
			system: 'custom',
			custom: { formula: 'rating + 1000' }
		});
		expect(() =>
			calculateRating(overflowing, { rating: 999_999_999 }, { rating: 0 }, 1, calculationTime)
		).toThrow(RatingCalculationError);
	});

	test('fuzzed formulas either reject or return a bounded finite number', () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 500 }),
				fc.record({
					rating: fc.double({
						min: -1_000_000,
						max: 1_000_000,
						noNaN: true,
						noDefaultInfinity: true
					}),
					opponentRating: fc.double({
						min: -1_000_000,
						max: 1_000_000,
						noNaN: true,
						noDefaultInfinity: true
					}),
					score: outcome,
					expected: fc.double({
						min: 0,
						max: 1,
						noNaN: true,
						noDefaultInfinity: true
					})
				}),
				(formula, context) => {
					try {
						const result = compileRatingFormula(formula)(context);
						expect(Number.isFinite(result)).toBe(true);
						expect(Math.abs(result)).toBeLessThanOrEqual(1_000_000_000);
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
					}
				}
			),
			{ numRuns: 2000 }
		);
	});
});
