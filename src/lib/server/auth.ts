import { error } from '@sveltejs/kit';

/**
 * Validate authentication at server-action boundaries before parsing requests or
 * creating a service-role client.
 */
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
