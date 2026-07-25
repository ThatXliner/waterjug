export const MAX_DISPLAY_NAME_LENGTH = 50;

export function validateDisplayName(value: FormDataEntryValue | null) {
	const displayName = value?.toString().trim() ?? '';

	if (!displayName) {
		return { error: 'Display name is required' } as const;
	}

	if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
		return {
			error: `Display name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`
		} as const;
	}

	return { displayName } as const;
}

export function canUpdateProfile(currentUserId: string | undefined, profileUserId: string) {
	return currentUserId === profileUserId;
}
