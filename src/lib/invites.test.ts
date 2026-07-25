import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
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

	it('normalizes every valid list without changing first-seen order', () => {
		const atom = fc.stringMatching(/^[a-z0-9]{1,20}$/);
		const email = fc
			.tuple(atom, atom, fc.stringMatching(/^[a-z]{2,8}$/))
			.map(([local, domain, tld]) => `${local}@${domain}.${tld}`);
		const separator = fc.constantFrom(',', ';', ' ', '\n', '\t', ',\n', '; ');

		fc.assert(
			fc.property(fc.array(email, { maxLength: 100 }), separator, (generated, delimiter) => {
				const duplicatedAndMixedCase = generated.flatMap((value, index) =>
					index % 3 === 0 ? [value.toUpperCase(), value] : [value]
				);
				const expected = [...new Set(generated)];
				const parsed = parseInviteEmails(` \n${duplicatedAndMixedCase.join(delimiter)};\t`);

				expect(parsed).toEqual({ emails: expected, error: null });
			}),
			{ numRuns: 500 }
		);
	});

	it('never returns a partial invite list when fuzzed input contains an invalid token', () => {
		const validEmail = fc
			.tuple(fc.stringMatching(/^[a-z0-9]{1,20}$/), fc.stringMatching(/^[a-z0-9]{1,20}$/))
			.map(([local, domain]) => `${local}@${domain}.test`);
		const invalidToken = fc.stringMatching(/^[a-zA-Z0-9._-]{1,64}$/);

		fc.assert(
			fc.property(fc.array(validEmail, { maxLength: 30 }), invalidToken, (valid, invalid) => {
				const parsed = parseInviteEmails([...valid, invalid].join(','));
				expect(parsed.emails).toEqual([]);
				expect(parsed.error).toContain(invalid.toLowerCase());
			}),
			{ numRuns: 500 }
		);
	});
});
