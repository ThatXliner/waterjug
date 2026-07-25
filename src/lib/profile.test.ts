import { describe, expect, it } from 'vitest';
import { MAX_DISPLAY_NAME_LENGTH, canUpdateProfile, validateDisplayName } from './profile';

describe('profile authorization', () => {
	it('only allows the matching authenticated user to update a profile', () => {
		expect(canUpdateProfile('user-a', 'user-a')).toBe(true);
		expect(canUpdateProfile('user-a', 'user-b')).toBe(false);
		expect(canUpdateProfile(undefined, 'user-a')).toBe(false);
	});
});

describe('display name validation', () => {
	it('trims a valid display name', () => {
		expect(validateDisplayName('  Water Wizard  ')).toEqual({ displayName: 'Water Wizard' });
	});

	it('rejects empty display names', () => {
		expect(validateDisplayName('   ')).toEqual({ error: 'Display name is required' });
		expect(validateDisplayName(null)).toEqual({ error: 'Display name is required' });
	});

	it('rejects names longer than the database limit', () => {
		expect(validateDisplayName('a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toEqual({
			error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`
		});
	});
});
