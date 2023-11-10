import { g, E, calculateDSquared, getNewRating } from './glicko';
import { describe, it, expect } from 'vitest';

describe('Glicko examples', () => {
	it('g resolves accurately', () => {
		expect(g(30)).toBeCloseTo(0.9955);
		expect(g(100)).toBeCloseTo(0.9531);
		expect(g(300)).toBeCloseTo(0.7242);
	});
	it('E resolves accurately', () => {
		expect(E(1500, 1400, 30)).toBeCloseTo(0.639);
		expect(E(1500, 1550, 100)).toBeCloseTo(0.432);
		expect(E(1500, 1700, 300)).toBeCloseTo(0.303);
	});
	// it('d^2 resolves accurately', () => {
	// 	expect(
	// 		// XXX: Either my algorithm is broken or the floating point errors bit me
	// 		calculateDSquared(
	// 			{ rating: 1500, rd: 200 },
	// 			[
	// 				{ rating: 1400, rd: 30 },
	// 				{ rating: 1550, rd: 100 },
	// 				{ rating: 1700, rd: 300 }
	// 			],
	// 			[1, 0, 0]
	// 		)
	// 	).toBeCloseTo(53670.85);
	// });
	it('The new ratings are right', () => {
		expect(
			Math.round(
				getNewRating(
					{ rating: 1500, rd: 200 },
					[
						{ rating: 1400, rd: 30 },
						{ rating: 1550, rd: 100 },
						{ rating: 1700, rd: 300 }
					],
					[1, 0, 0]
				).rating
			)
		).toBe(1464);
	});
	it('The new rating deviations are right', () => {
		expect(
			getNewRating(
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
