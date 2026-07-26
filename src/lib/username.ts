export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])$/;
export const USERNAME_REQUIREMENTS =
	'Use 3–30 letters, numbers, or underscores, beginning and ending with a letter or number.';

export function normalizeUsername(value: string): string {
	return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
	return USERNAME_PATTERN.test(value);
}

export function validateUsername(value: string): string | null {
	const username = normalizeUsername(value);

	if (
		username.length < USERNAME_MIN_LENGTH ||
		username.length > USERNAME_MAX_LENGTH ||
		!isValidUsername(username)
	) {
		return USERNAME_REQUIREMENTS;
	}

	return null;
}
