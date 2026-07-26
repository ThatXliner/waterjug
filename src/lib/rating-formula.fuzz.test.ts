import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
	RatingFormulaError,
	evaluateRatingFormula,
	validateRatingFormula,
	type RatingFormulaContext
} from './rating';

const FUZZ_SEED = 0x13c0de;
const GENERAL_RUNS = 2_000;
const STRUCTURAL_RUNS = 1_000;

const variables = ['rating', 'opponentRating', 'score', 'expected'] as const;
const binaryOperators = ['+', '-', '*', '/', '%', '^'] as const;

const numberExpression = fc.oneof(
	fc.integer({ min: -1_000_000, max: 1_000_000 }).map(String),
	fc
		.double({
			min: -1_000_000,
			max: 1_000_000,
			noNaN: true,
			noDefaultInfinity: true
		})
		.map((value) => String(value))
);

function validExpressionArbitrary(): fc.Arbitrary<string> {
	let expression: fc.Arbitrary<string> = fc.oneof(numberExpression, fc.constantFrom(...variables));

	for (let depth = 0; depth < 4; depth += 1) {
		const previous = expression;
		const binary = fc
			.tuple(previous, fc.constantFrom(...binaryOperators), previous)
			.map(([left, operator, right]) => `(${left} ${operator} ${right})`);
		const unary = fc
			.tuple(fc.constantFrom('+', '-'), previous)
			.map(([operator, operand]) => `${operator}(${operand})`);
		const unaryFunction = fc
			.tuple(fc.constantFrom('abs', 'ceil', 'floor', 'round'), previous)
			.map(([name, argument]) => `${name}(${argument})`);
		const binaryFunction = fc
			.tuple(fc.constantFrom('pow', 'min', 'max'), previous, previous)
			.map(([name, first, second]) => `${name}(${first}, ${second})`);
		expression = fc.oneof(
			{ depthSize: 'small' },
			previous,
			binary,
			unary,
			unaryFunction,
			binaryFunction
		);
	}

	return expression.filter((value) => value.length <= 500);
}

const finiteContext = fc.record({
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
	score: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
	expected: fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
});

const anyNumericContext = fc.record({
	rating: fc.double(),
	opponentRating: fc.double(),
	score: fc.double(),
	expected: fc.double()
});

function captureEvaluation(formula: string, context: RatingFormulaContext) {
	try {
		return { type: 'value' as const, value: evaluateRatingFormula(formula, context) };
	} catch (error) {
		if (!(error instanceof RatingFormulaError)) throw error;
		return { type: 'error' as const, message: error.message, position: error.position };
	}
}

function expectActionableFormulaError(
	error: unknown,
	source: string
): asserts error is RatingFormulaError {
	expect(error).toBeInstanceOf(RatingFormulaError);
	const formulaError = error as RatingFormulaError;
	expect(formulaError.message.trim().length).toBeGreaterThan(8);
	if (formulaError.position !== undefined) {
		expect(Number.isInteger(formulaError.position)).toBe(true);
		expect(formulaError.position).toBeGreaterThanOrEqual(0);
		expect(formulaError.position).toBeLessThanOrEqual(source.length);
		expect(formulaError.message).toContain(`character ${formulaError.position + 1}`);
	}
}

describe('custom rating formula adversarial properties', () => {
	test('all generated valid expressions validate and evaluate deterministically', () => {
		fc.assert(
			fc.property(validExpressionArbitrary(), finiteContext, (formula, context) => {
				expect(() => validateRatingFormula(formula)).not.toThrow();

				const first = captureEvaluation(formula, context);
				const second = captureEvaluation(formula, context);
				expect(second).toEqual(first);

				if (first.type === 'value') {
					expect(Number.isFinite(first.value)).toBe(true);
					expect(Math.abs(first.value)).toBeLessThanOrEqual(1_000_000_000);
				} else {
					expect(first.message.length).toBeGreaterThan(8);
				}
			}),
			{ seed: FUZZ_SEED, numRuns: STRUCTURAL_RUNS }
		);
	});

	test('arbitrary Unicode input cannot crash validation or leak non-actionable errors', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 800 }), (formula) => {
				try {
					validateRatingFormula(formula);
				} catch (error) {
					expectActionableFormulaError(error, formula);
				}
			}),
			{ seed: FUZZ_SEED + 1, numRuns: GENERAL_RUNS }
		);
	});

	test('arbitrary formulas and numeric contexts only return bounded values or domain errors', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 800 }), anyNumericContext, (formula, context) => {
				try {
					const value = evaluateRatingFormula(formula, context);
					expect(Number.isFinite(value)).toBe(true);
					expect(Math.abs(value)).toBeLessThanOrEqual(1_000_000_000);
				} catch (error) {
					expectActionableFormulaError(error, formula);
				}
			}),
			{ seed: FUZZ_SEED + 2, numRuns: GENERAL_RUNS }
		);
	});

	test('generated forbidden identifiers and access forms are always rejected', () => {
		const identifier = fc
			.tuple(
				fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'),
				fc.array(
					fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789'),
					{ maxLength: 40 }
				)
			)
			.map(([first, rest]) => first + rest.join(''))
			.filter(
				(value) =>
					![...variables, 'abs', 'ceil', 'floor', 'max', 'min', 'pow', 'round'].includes(value)
			);

		fc.assert(
			fc.property(
				identifier,
				fc.constantFrom(
					(identifier: string) => identifier,
					(identifier: string) => `${identifier}(1)`,
					(identifier: string) => `rating.${identifier}`,
					(identifier: string) => `rating[${identifier}]`,
					(identifier: string) => `${identifier}::rating`
				),
				(name, build) => {
					const formula = build(name);
					expect(() => validateRatingFormula(formula)).toThrow(RatingFormulaError);
				}
			),
			{ seed: FUZZ_SEED + 3, numRuns: STRUCTURAL_RUNS }
		);
	});

	test('generated malformed operators and unbalanced delimiters are rejected actionably', () => {
		const malformed = fc.oneof(
			fc
				.tuple(
					fc.constantFrom('rating', 'opponentRating', 'score', '1'),
					fc.constantFrom('**', '//', '^^', '==', '=>', '&&', '||', '??'),
					fc.constantFrom('rating', 'opponentRating', 'score', '1')
				)
				.map(([left, operator, right]) => `${left} ${operator} ${right}`),
			fc
				.tuple(
					fc.integer({ min: 1, max: 100 }),
					fc.integer({ min: 0, max: 99 }),
					fc.constantFrom('(', ')')
				)
				.filter(([first, second]) => first !== second)
				.map(([leftCount, rightCount, delimiter]) =>
					delimiter === '('
						? '('.repeat(leftCount) + 'rating' + ')'.repeat(rightCount)
						: '('.repeat(rightCount) + 'rating' + ')'.repeat(leftCount)
				),
			fc
				.tuple(
					fc.constantFrom('abs', 'pow', 'max', 'min'),
					fc.string({ maxLength: 40 }).filter((tail) => !tail.includes(')'))
				)
				.map(([name, tail]) => `${name}(${tail}`)
		);

		fc.assert(
			fc.property(malformed, (formula) => {
				try {
					validateRatingFormula(formula);
					throw new Error(`Malformed formula unexpectedly validated: ${formula}`);
				} catch (error) {
					expectActionableFormulaError(error, formula);
				}
			}),
			{ seed: FUZZ_SEED + 9, numRuns: STRUCTURAL_RUNS }
		);
	});

	test('generated injection and delimiter escape attempts have no capabilities', () => {
		const canaryName = '__waterjugFormulaCapabilityCanary';
		const globals = globalThis as typeof globalThis & Record<string, unknown>;
		globals[canaryName] = 0;
		const originalPrototypeValue = (Object.prototype as Record<string, unknown>)[canaryName];

		try {
			const payload = fc
				.tuple(
					fc.constantFrom(
						'globalThis',
						'window',
						'process',
						'require',
						'import',
						'eval',
						'Function',
						'constructor',
						'__proto__',
						'prototype',
						canaryName
					),
					fc.constantFrom('.', '?.', '["', "['", '`', '${', ');', '=>', '=', '/*', '//', '\n'),
					fc.string({ maxLength: 80 })
				)
				.map(([root, escape, tail]) => `${root}${escape}${tail}`);

			fc.assert(
				fc.property(payload, (formula) => {
					expect(() => validateRatingFormula(formula)).toThrow(RatingFormulaError);
					expect(globals[canaryName]).toBe(0);
					expect((Object.prototype as Record<string, unknown>)[canaryName]).toBe(
						originalPrototypeValue
					);
				}),
				{ seed: FUZZ_SEED + 4, numRuns: GENERAL_RUNS }
			);
		} finally {
			delete globals[canaryName];
		}
	});

	test('deep nesting and token floods fail within fixed resource bounds', () => {
		fc.assert(
			fc.property(fc.integer({ min: 33, max: 2_000 }), (depth) => {
				const formula = '('.repeat(depth) + 'rating' + ')'.repeat(depth);
				expect(() => validateRatingFormula(formula)).toThrow(RatingFormulaError);
			}),
			{ seed: FUZZ_SEED + 5, numRuns: STRUCTURAL_RUNS }
		);

		fc.assert(
			fc.property(fc.integer({ min: 101, max: 5_000 }), (terms) => {
				const formula = Array.from({ length: terms }, () => '1').join('+');
				expect(() => validateRatingFormula(formula)).toThrow(RatingFormulaError);
			}),
			{ seed: FUZZ_SEED + 6, numRuns: STRUCTURAL_RUNS }
		);
	});

	test('numeric literal and context extremes never escape finite result checks', () => {
		const extremeLiteral = fc.oneof(
			fc.integer({ min: 309, max: 100_000 }).map((exponent) => `1e${exponent}`),
			fc.integer({ min: 309, max: 100_000 }).map((exponent) => `-1e${exponent}`),
			fc.constantFrom('NaN', 'Infinity', '-Infinity', '0/0', '1/0', '-1/0')
		);

		fc.assert(
			fc.property(extremeLiteral, finiteContext, (formula, context) => {
				expect(() => evaluateRatingFormula(formula, context)).toThrow(RatingFormulaError);
			}),
			{ seed: FUZZ_SEED + 7, numRuns: STRUCTURAL_RUNS }
		);

		for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			for (const variable of variables) {
				const context = { rating: 1200, opponentRating: 1300, score: 1, expected: 0.4 };
				context[variable] = invalidValue;
				expect(() => evaluateRatingFormula('rating + score', context)).toThrow(
					`context variable "${variable}" must be a finite number`
				);
			}
		}

		for (const finiteExtreme of [
			Number.MAX_VALUE,
			-Number.MAX_VALUE,
			Number.MIN_VALUE,
			-Number.MIN_VALUE,
			Number.MAX_SAFE_INTEGER,
			Number.MIN_SAFE_INTEGER
		]) {
			const outcome = captureEvaluation('rating', {
				rating: finiteExtreme,
				opponentRating: 1300,
				score: 1,
				expected: 0.4
			});
			if (Math.abs(finiteExtreme) <= 1_000_000_000) {
				expect(outcome).toEqual({ type: 'value', value: finiteExtreme });
			} else {
				expect(outcome.type).toBe('error');
			}
		}
	});

	test('worst-case accepted-size hostile corpus has bounded execution', { timeout: 5_000 }, () => {
		const nearTokenLimit = fc
			.array(fc.constantFrom('+', '-', '*', '/', '%', '^'), {
				minLength: 90,
				maxLength: 99
			})
			.map((operators) => `1${operators.map((operator) => `${operator}1`).join('')}`);
		const nearDepthLimit = fc
			.integer({ min: 25, max: 32 })
			.map((depth) => '('.repeat(depth) + 'rating' + ')'.repeat(depth));
		const longIdentifier = fc
			.integer({ min: 450, max: 500 })
			.map((length) => `a${'0'.repeat(length - 1)}`);
		const corpus = fc.sample(
			fc.oneof(
				fc.string({ minLength: 450, maxLength: 500 }),
				nearTokenLimit,
				nearDepthLimit,
				longIdentifier
			),
			{ seed: FUZZ_SEED + 8, numRuns: 5_000 }
		);
		const startedAt = performance.now();
		for (const formula of corpus) {
			try {
				evaluateRatingFormula(formula, {
					rating: 1200,
					opponentRating: 1300,
					score: 1,
					expected: 0.4
				});
			} catch (error) {
				expect(error).toBeInstanceOf(RatingFormulaError);
			}
		}
		expect(performance.now() - startedAt).toBeLessThan(2_000);
	});
});
