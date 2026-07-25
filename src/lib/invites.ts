const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ParsedInvites = { emails: string[]; error: null } | { emails: []; error: string };

export function parseInviteEmails(value: FormDataEntryValue | null): ParsedInvites {
	const emails = [
		...new Set(
			(value?.toString() ?? '')
				.split(/[\s,;]+/)
				.map((email) => email.trim().toLowerCase())
				.filter(Boolean)
		)
	];
	const invalid = emails.find((email) => !EMAIL_PATTERN.test(email));

	if (invalid) {
		return { emails: [], error: `"${invalid}" is not a valid email address.` };
	}

	return { emails, error: null };
}
