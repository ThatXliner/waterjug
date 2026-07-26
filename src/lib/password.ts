export const MIN_PASSWORD_LENGTH = 6;

export function validateNewPassword(password: string, confirmation: string): string | null {
	if (password.length < MIN_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
	}

	if (password !== confirmation) {
		return 'Passwords do not match.';
	}

	return null;
}
