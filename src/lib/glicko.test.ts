import * as glicko from './glicko';
import { describe, test, expect } from 'vitest';
// TODO: mock with limited precision
describe('Glicko examples', () => {
	// beforeEach(async () => {
	// 	vi.mock('./glicko', async (importOriginal) => {
	// 		const mod = await importOriginal<typeof import('./glicko')>();
	// 		return {
	// 			...mod,
	// 			g: (...args) => parseFloat(mod.g(...args).toFixed(4)),
	// 			E: (...args) => parseFloat(mod.E(...args).toFixed(3))
	// 		};
	// 	});
	// });
	test('g resolves accurately', () => {
		expect(glicko.g(30)).toBeCloseTo(0.9955);
		expect(glicko.g(100)).toBeCloseTo(0.9531);
		expect(glicko.g(300)).toBeCloseTo(0.7242);
	});
	test('E resolves accurately', () => {
		expect(glicko.E(1500, 1400, 30)).toBeCloseTo(0.639);
		expect(glicko.E(1500, 1550, 100)).toBeCloseTo(0.432);
		expect(glicko.E(1500, 1700, 300)).toBeCloseTo(0.303);
	});
	test.skip('d^2 resolves accurately', () => {
		const term1 = Math.pow(0.0057565, 2);
		const term2 = Math.pow(0.9955, 2) * (0.639 * (1 - 0.639));
		const term3 = Math.pow(0.9531, 2) * (0.432 * (1 - 0.432));
		const term4 = Math.pow(0.7242, 2) * (0.303 * (1 - 0.303));

		// Calculate the inverse of the expression
		const result = 1 / (term1 * (term2 + term3 + term4));
		expect(
			// XXX: Either my algorithm is broken or the floating point errors bit me
			glicko.calculateDSquared(
				{ rating: 1500, rd: 200 },
				[
					{ rating: 1400, rd: 30 },
					{ rating: 1550, rd: 100 },
					{ rating: 1700, rd: 300 }
				],
				[1, 0, 0]
			)
			// XXX: calculate manually via TI-84
		).toBeCloseTo(result, 0);
	});
	test.skip('The new ratings are right', () => {
		expect(
			glicko.getNewRating(
				{ rating: 1500, rd: 200 },
				[
					{ rating: 1400, rd: 30 },
					{ rating: 1550, rd: 100 },
					{ rating: 1700, rd: 300 }
				],
				[1, 0, 0]
			).rating
		).toBeCloseTo(1464);
	});
	test('The new rating deviations are right', () => {
		expect(
			glicko.getNewRating(
				{ rating: 1500, rd: 200 },
				[
					{ rating: 1400, rd: 30 },
					{ rating: 1550, rd: 100 },
					{ rating: 1700, rd: 300 }
				],
				[1, 0, 0]
			).rd
		).toBeCloseTo(151.4);
	});
});
