import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { APP_ROLES, DEFAULT_APP_ROLE, hasAppRole, isAppRole } from './roles';

describe('application roles', () => {
	it('defines the complete role set and default consistently', () => {
		expect(APP_ROLES).toEqual(['player', 'admin']);
		expect(DEFAULT_APP_ROLE).toBe('player');
		expect(APP_ROLES).toContain(DEFAULT_APP_ROLE);
	});

	it('rejects unknown and missing role values', () => {
		expect(isAppRole('admin')).toBe(true);
		expect(isAppRole('service_role')).toBe(false);
		expect(isAppRole(null)).toBe(false);
	});

	it('only authorizes explicitly allowed roles', () => {
		expect(hasAppRole('admin', ['admin'])).toBe(true);
		expect(hasAppRole('player', ['admin'])).toBe(false);
		expect(hasAppRole(null, ['player', 'admin'])).toBe(false);
	});

	it('never recognizes generated non-role input as an application role', () => {
		fc.assert(
			fc.property(fc.anything(), (candidate) => {
				expect(isAppRole(candidate)).toBe(APP_ROLES.some((role) => role === candidate));
			})
		);
	});

	it('authorizes exactly the generated role/allow-list combinations', () => {
		fc.assert(
			fc.property(
				fc.option(fc.constantFrom(...APP_ROLES), { nil: null }),
				fc.uniqueArray(fc.constantFrom(...APP_ROLES)),
				(role, allowedRoles) => {
					expect(hasAppRole(role, allowedRoles)).toBe(role !== null && allowedRoles.includes(role));
				}
			)
		);
	});
});
