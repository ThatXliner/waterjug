import type { Session, User } from '@supabase/supabase-js';

type SessionAuthClient = {
	getSession: () => Promise<{ data: { session: Session | null } }>;
	getUser: () => Promise<{ data: { user: User | null }; error: unknown }>;
};

export async function getVerifiedSession(
	auth: SessionAuthClient
): Promise<{ session: Session | null; user: User | null }> {
	const {
		data: { session }
	} = await auth.getSession();
	if (!session) {
		return { session: null, user: null };
	}

	const {
		data: { user },
		error
	} = await auth.getUser();
	if (error || !user || user.id !== session.user.id) {
		return { session: null, user: null };
	}

	return { session, user };
}
