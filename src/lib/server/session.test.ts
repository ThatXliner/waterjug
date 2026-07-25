import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { Session, User } from '@supabase/supabase-js';
import { getVerifiedSession } from './session';

function user(id: string): User {
	return { id } as User;
}

function session(id: string): Session {
	return { user: user(id) } as Session;
}

describe('verified sessions', () => {
	it('does not trust or validate absent client sessions', async () => {
		const getUser = vi.fn();
		await expect(
			getVerifiedSession({
				getSession: async () => ({ data: { session: null } }),
				getUser
			})
		).resolves.toEqual({ session: null, user: null });
		expect(getUser).not.toHaveBeenCalled();
	});

	it('rejects malformed, failed, missing, and identity-mismatched credentials', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.uuid(),
				fc.uuid(),
				fc.boolean(),
				fc.boolean(),
				async (sessionId, verifiedId, hasError, omitVerifiedUser) => {
					const candidateSession = session(sessionId);
					const verifiedUser = omitVerifiedUser ? null : user(verifiedId);
					const result = await getVerifiedSession({
						getSession: async () => ({ data: { session: candidateSession } }),
						getUser: async () => ({
							data: { user: verifiedUser },
							error: hasError ? new Error('invalid JWT') : null
						})
					});

					const isValid = !hasError && verifiedUser !== null && sessionId === verifiedId;
					expect(result).toEqual(
						isValid
							? { session: candidateSession, user: verifiedUser }
							: { session: null, user: null }
					);
				}
			)
		);
	});
});
