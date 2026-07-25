export const MAX_DISPLAY_NAME_LENGTH = 50;
export const DISPLAY_NAME_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function validateDisplayName(value: FormDataEntryValue | null) {
	if (typeof value !== 'string') {
		return { error: 'Display name must be text' } as const;
	}

	const displayName = value.trim();

	if (!displayName) {
		return { error: 'Display name is required' } as const;
	}

	if (DISPLAY_NAME_CONTROL_CHARACTERS.test(displayName)) {
		return { error: 'Display name cannot contain control characters' } as const;
	}

	// PostgreSQL char_length counts Unicode code points rather than UTF-16 code units.
	if ([...displayName].length > MAX_DISPLAY_NAME_LENGTH) {
		return {
			error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`
		} as const;
	}

	return { displayName } as const;
}

export function canUpdateProfile(currentUserId: string | undefined, profileUserId: string) {
	return currentUserId === profileUserId;
}
