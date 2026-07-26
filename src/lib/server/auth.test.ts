import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { requireAuthenticatedUserId } from './auth';

describe('server authentication boundary', () => {
	test('accepts every nonblank authenticated user ID', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: 1 }).filter((id) => id.trim().length > 0),
				(id) => {
					expect(requireAuthenticatedUserId({ id })).toBe(id);
				}
			),
			{ numRuns: 1000 }
		);
	});

	test('rejects arbitrary malformed authentication state with 401', () => {
		fc.assert(
			fc.property(fc.anything(), (user) => {
				fc.pre(
					!(
						typeof user === 'object' &&
						user !== null &&
						'id' in user &&
						typeof user.id === 'string' &&
						user.id.trim().length > 0
					)
				);

				try {
					requireAuthenticatedUserId(user);
					expect.unreachable('Expected authentication to be rejected');
				} catch (authenticationError) {
					expect(authenticationError).toMatchObject({ status: 401 });
				}
			}),
			{ numRuns: 1000 }
		);
	});
});
