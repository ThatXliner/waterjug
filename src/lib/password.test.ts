import { describe, expect, it } from 'vitest';

import { validateNewPassword } from './password';

describe('validateNewPassword', () => {
	it('rejects passwords shorter than six characters', () => {
		expect(validateNewPassword('short', 'short')).toBe('Password must be at least 6 characters.');
	});

	it('rejects a mismatched confirmation', () => {
		expect(validateNewPassword('new-password', 'different-password')).toBe(
			'Passwords do not match.'
		);
	});

	it('accepts a matching password of at least six characters', () => {
		expect(validateNewPassword('new-password', 'new-password')).toBeNull();
	});
});
