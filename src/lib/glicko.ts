// In-house implementations of glicko and glicko-2

// We don't use the glicko2 library because there's no types
// and I want to learn the internals

// TODO: Proper rating period implementation

// const defaultRating = 1500;
export const defaultRD = 350;
/* "a constant that governs the increase in uncertainty between rating
 periods" */
// TODO: properly calculate C rather than take the values presented in the paper
const c = 63.2;

const q = Math.log(10) / 400; // Some random constant in the paper
export function calculateRD(oldRD: number = defaultRD) {
	return Math.min(Math.sqrt(s(oldRD) + s(c)), defaultRD);
}
export type Player = { rating: number; rd: number };
function sum(x: number[]) {
	let o = 0;
	for (const y of x) {
		o += y;
	}
	return o;
}
/// Shorthand for Math.pow(x, 2)
function s(x: number) {
	return Math.pow(x, 2);
}
export function g(RD: number) {
	return 1 / Math.sqrt(1 + (3 * s(q) * s(RD)) / s(Math.PI));
}
export function E(r: number, rj: number, RDj: number) {
	return 1 / (1 + Math.pow(10, (-g(RDj) * (r - rj)) / 400));
}
export function calculateDSquared(player: Player, opponents: Player[], results: (0 | 0.5 | 1)[]) {
	return (
		1 /
		(s(q) *
			sum(
				results.map((_, index) => {
					return (
						s(g(opponents[index].rd)) *
						E(player.rating, opponents[index].rating, opponents[index].rd) *
						(1 - E(player.rating, opponents[index].rating, opponents[index].rd))
					);
				})
			))
	);
}
export function getNewRating(
	player: Player,
	opponents: Player[],
	results: (0 | 0.5 | 1)[]
): Player {
	const newRating =
		player.rating +
		(q / (1 / s(calculateRD(player.rd)) + 1 / calculateDSquared(player, opponents, results))) *
			sum(
				opponents.map(
					(opponent, index) =>
						g(opponent.rd) * (results[index] - E(player.rating, opponent.rating, opponent.rd))
				)
			);
	const newRD = Math.sqrt(
		1 / (1 / s(player.rd) + 1 / calculateDSquared(player, opponents, results))
	);
	return { rating: newRating, rd: newRD };
}

// Glicko-2
/* Reasonable choices are between 0.3 and 1.2, though
the system should be tested to decide which value
results in greatest predictive accuracy. Smaller values
of τ prevent the volatility measures from changing by
large 1 amounts, which in turn prevent
enormous changes in ratings based on very improbable results */
// const tau = 0.75; // Average of the recommended range
