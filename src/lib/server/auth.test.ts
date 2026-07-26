import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { requireAuthenticatedUserId, requireRole, requireUser } from './auth';

const user = { id: 'd34db33f-0000-4000-8000-000000000000' } as User;

describe('server authorization', () => {
	it('accepts every nonblank authenticated user ID', () => {
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

	it('rejects arbitrary malformed authentication state with 401', () => {
		fc.assert(
			fc.property(fc.anything(), (candidate) => {
				fc.pre(
					!(
						typeof candidate === 'object' &&
						candidate !== null &&
						'id' in candidate &&
						typeof candidate.id === 'string' &&
						candidate.id.trim().length > 0
					)
				);

				expect(() => requireAuthenticatedUserId(candidate)).toThrowError(
					expect.objectContaining({ status: 401 })
				);
			}),
			{ numRuns: 1000 }
		);
	});

	it('rejects anonymous users before checking a role', () => {
		expect(() => requireUser({ user: null, role: null })).toThrowError(
			expect.objectContaining({ status: 401 })
		);
	});

	it('rejects authenticated users without the required role', () => {
		expect(() => requireRole({ user, role: 'player' }, 'admin')).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('returns the verified user when the role is allowed', () => {
		expect(requireRole({ user, role: 'admin' }, 'admin')).toBe(user);
		expect(requireRole({ user, role: 'player' }, 'player', 'admin')).toBe(user);
	});
});
