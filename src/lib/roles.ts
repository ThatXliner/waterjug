export const APP_ROLES = ['player', 'admin'] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const DEFAULT_APP_ROLE: AppRole = 'player';

export function isAppRole(value: unknown): value is AppRole {
	return typeof value === 'string' && APP_ROLES.includes(value as AppRole);
}

export function hasAppRole(role: AppRole | null, allowedRoles: readonly AppRole[]): boolean {
	return role !== null && allowedRoles.includes(role);
}
