import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MIN_PASSWORD_LENGTH, validateNewPassword } from './password';

describe('validateNewPassword', () => {
	it.each([
		['', '', 'Password must be at least 6 characters.'],
		['12345', '12345', 'Password must be at least 6 characters.'],
		['123456', '123456', null],
		['1234567', '1234567', null],
		['      ', '      ', null],
		['🔐🔐🔐', '🔐🔐🔐', null]
	])('handles boundary input %#', (password, confirmation, expected) => {
		expect(validateNewPassword(password, confirmation)).toBe(expected);
	});

	it('rejects every generated password shorter than the minimum, regardless of confirmation', () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: MIN_PASSWORD_LENGTH - 1 }),
				fc.string(),
				(password, confirmation) => {
					expect(validateNewPassword(password, confirmation)).toBe(
						`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
					);
				}
			),
			{ numRuns: 1000 }
		);
	});

	it('accepts every generated matching password at or above the minimum', () => {
		fc.assert(
			fc.property(fc.string({ minLength: MIN_PASSWORD_LENGTH }), (password) => {
				expect(validateNewPassword(password, password)).toBeNull();
			}),
			{ numRuns: 1000 }
		);
	});

	it('rejects every generated mismatched confirmation for a valid-length password', () => {
		fc.assert(
			fc.property(
				fc.string({ minLength: MIN_PASSWORD_LENGTH }),
				fc.string(),
				(password, suffix) => {
					expect(validateNewPassword(password, `${password}\u0000${suffix}`)).toBe(
						'Passwords do not match.'
					);
				}
			),
			{ numRuns: 1000 }
		);
	});
});
