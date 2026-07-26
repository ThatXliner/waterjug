import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
	calculateRatingMatchWithFormulaEvaluator,
	evaluateRatingFormula,
	parseRatingConfiguration,
	RatingFormulaError
} from '$lib/rating';
import {
	evaluateRatingFormulaIsolated,
	preflightRatingFormulaIsolated
} from './rating-formula-worker';

const contextArbitrary = fc.record({
	rating: fc.double({
		min: -100_000,
		max: 100_000,
		noNaN: true,
		noDefaultInfinity: true
	}),
	opponentRating: fc.double({
		min: -100_000,
		max: 100_000,
		noNaN: true,
		noDefaultInfinity: true
	}),
	score: fc.constantFrom(0, 0.5, 1),
	expected: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
});

const formulaArbitrary = fc.oneof(
	fc.constantFrom(
		'rating',
		'round(rating + 32 * (score - expected))',
		'min(1000000000, max(-1000000000, rating + opponentRating))',
		'abs(rating - opponentRating)',
		'pow(score - expected, 3) + rating',
		'ceil(rating) - floor(expected)'
	),
	fc
		.tuple(
			fc.constantFrom('rating', 'opponentRating', 'score', 'expected'),
			fc.constantFrom('+', '-', '*'),
			fc.integer({ min: -100, max: 100 })
		)
		.map(([variable, operator, value]) => `${variable} ${operator} ${value}`)
);

describe('isolated rating formula worker', () => {
	test('evaluates a match batch without changing formula semantics', async () => {
		const contexts = [
			{ rating: 1200, opponentRating: 1200, score: 1, expected: 0.5 },
			{ rating: 1200, opponentRating: 1200, score: 0, expected: 0.5 }
		];
		await expect(
			evaluateRatingFormulaIsolated('round(rating + 20 * (score - expected))', contexts)
		).resolves.toEqual([1210, 1190]);
	});

	test('drives the application match-calculation boundary for custom ratings', async () => {
		const configuration = parseRatingConfiguration({
			system: 'custom',
			custom: { formula: 'round(rating + 20 * (score - expected))' }
		});
		await expect(
			calculateRatingMatchWithFormulaEvaluator(
				configuration,
				{ rating: 1200 },
				{ rating: 1200 },
				1,
				evaluateRatingFormulaIsolated,
				new Date('2026-07-25T00:00:00.000Z')
			)
		).resolves.toEqual({
			player: { rating: 1210, lastRatedAt: '2026-07-25T00:00:00.000Z' },
			opponent: { rating: 1190, lastRatedAt: '2026-07-25T00:00:00.000Z' }
		});
	});

	test('matches the in-process reference evaluator across fuzzed formulas and contexts', async () => {
		await fc.assert(
			fc.asyncProperty(
				formulaArbitrary,
				fc.array(contextArbitrary, { minLength: 1, maxLength: 2 }),
				async (formula, contexts) => {
					const expected = contexts.map((context) => evaluateRatingFormula(formula, context));
					await expect(evaluateRatingFormulaIsolated(formula, contexts)).resolves.toEqual(expected);
				}
			),
			{ seed: 0x1501a7ed, numRuns: 100 }
		);
	});

	test('contains non-finite failures inside the worker and returns a domain error', async () => {
		await expect(preflightRatingFormulaIsolated('rating / 0')).rejects.toThrow(
			'formula result must be a finite number'
		);
	});

	test('terminates work that exceeds its CPU deadline', async () => {
		await expect(preflightRatingFormulaIsolated('rating + 1', { timeoutMs: 0 })).rejects.toEqual(
			expect.objectContaining({
				name: 'RatingFormulaError',
				message: 'formula execution exceeded 0 milliseconds'
			})
		);
	});

	test('rejects invalid timeout and batch inputs before they can consume worker resources', async () => {
		expect(() => evaluateRatingFormulaIsolated('rating', [], { timeoutMs: -1 })).toThrow(
			RatingFormulaError
		);
		await expect(
			evaluateRatingFormulaIsolated('rating', [
				{ rating: 1, opponentRating: 2, score: 1, expected: 0.5 },
				{ rating: 2, opponentRating: 1, score: 0, expected: 0.5 },
				{ rating: 3, opponentRating: 1, score: 0, expected: 0.5 }
			])
		).rejects.toThrow('formula context batch is invalid');
	});
});
