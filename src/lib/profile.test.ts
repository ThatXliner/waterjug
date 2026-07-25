import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	DISPLAY_NAME_CONTROL_CHARACTERS,
	MAX_DISPLAY_NAME_LENGTH,
	canUpdateProfile,
	validateDisplayName
} from './profile';

describe('profile authorization', () => {
	it('only allows the matching authenticated user to update a profile', () => {
		expect(canUpdateProfile('user-a', 'user-a')).toBe(true);
		expect(canUpdateProfile('user-a', 'user-b')).toBe(false);
		expect(canUpdateProfile(undefined, 'user-a')).toBe(false);
	});

	it('grants access if and only if both IDs match', () => {
		fc.assert(
			fc.property(
				fc.option(fc.uuid(), { nil: undefined }),
				fc.uuid(),
				(currentUserId, profileId) => {
					expect(canUpdateProfile(currentUserId, profileId)).toBe(currentUserId === profileId);
				}
			),
			{ numRuns: 1_000 }
		);
	});
});

describe('display name validation', () => {
	it('trims a valid display name', () => {
		expect(validateDisplayName('  Water Wizard  ')).toEqual({ displayName: 'Water Wizard' });
	});

	it('rejects empty display names', () => {
		expect(validateDisplayName('   ')).toEqual({ error: 'Display name is required' });
	});

	it('rejects missing and non-text form values', () => {
		const formData = new FormData();
		formData.set('displayName', new Blob(['avatar']), 'avatar.txt');

		expect(validateDisplayName(null)).toEqual({ error: 'Display name must be text' });
		expect(validateDisplayName(formData.get('displayName'))).toEqual({
			error: 'Display name must be text'
		});
	});

	it('rejects names longer than the database limit', () => {
		expect(validateDisplayName('a'.repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toEqual({
			error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`
		});
	});

	it('counts Unicode code points like the database boundary does', () => {
		const emoji = '🫗';

		expect(validateDisplayName(emoji.repeat(MAX_DISPLAY_NAME_LENGTH))).toEqual({
			displayName: emoji.repeat(MAX_DISPLAY_NAME_LENGTH)
		});
		expect(validateDisplayName(emoji.repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toEqual({
			error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`
		});
	});

	it('rejects embedded control characters', () => {
		for (const character of ['\u0000', '\n', '\t', '\u001f', '\u007f']) {
			expect(validateDisplayName(`player${character}name`)).toEqual({
				error: 'Display name cannot contain control characters'
			});
		}
	});

	it('classifies arbitrary strings according to the validation invariants', () => {
		fc.assert(
			fc.property(fc.string(), (rawName) => {
				const result = validateDisplayName(rawName);
				const trimmedName = rawName.trim();

				if (!trimmedName) {
					expect(result).toEqual({ error: 'Display name is required' });
				} else if (DISPLAY_NAME_CONTROL_CHARACTERS.test(trimmedName)) {
					expect(result).toEqual({ error: 'Display name cannot contain control characters' });
				} else if ([...trimmedName].length > MAX_DISPLAY_NAME_LENGTH) {
					expect(result).toEqual({
						error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`
					});
				} else {
					expect(result).toEqual({ displayName: trimmedName });
				}
			}),
			{ numRuns: 2_000 }
		);
	});
});
