import { error } from '@sveltejs/kit';
import type { User } from '@supabase/supabase-js';
import { hasAppRole, type AppRole } from '$lib/roles';

type AuthorizationLocals = Pick<App.Locals, 'user' | 'role'>;

export function requireAuthenticatedUserId(user: unknown): string {
	if (
		typeof user !== 'object' ||
		user === null ||
		!('id' in user) ||
		typeof user.id !== 'string' ||
		user.id.trim().length === 0
	) {
		error(401, 'Authentication required');
	}

	return user.id;
}

export function requireUser(locals: AuthorizationLocals): User {
	requireAuthenticatedUserId(locals.user);

	return locals.user as User;
}

export function requireRole(
	locals: AuthorizationLocals,
	...allowedRoles: readonly AppRole[]
): User {
	const user = requireUser(locals);
	if (!hasAppRole(locals.role, allowedRoles)) {
		error(403, 'Insufficient permissions');
	}

	return user;
}
