import { describe, expect, it } from 'vitest';
import { parseInviteEmails } from './invites';

describe('parseInviteEmails', () => {
	it('normalizes, separates, and deduplicates invitation emails', () => {
		expect(parseInviteEmails(' Alice@Example.com,\nbob@example.com;alice@example.com ')).toEqual({
			emails: ['alice@example.com', 'bob@example.com'],
			error: null
		});
	});

	it('allows an empty invitation list for public games', () => {
		expect(parseInviteEmails(null)).toEqual({ emails: [], error: null });
	});

	it('rejects malformed email addresses', () => {
		expect(parseInviteEmails('player@example.com not-an-email')).toEqual({
			emails: [],
			error: '"not-an-email" is not a valid email address.'
		});
	});
});
