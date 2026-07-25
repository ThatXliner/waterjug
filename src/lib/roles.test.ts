import { describe, expect, it } from 'vitest';
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
});
