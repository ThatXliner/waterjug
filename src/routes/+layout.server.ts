import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession, supabase }, cookies }) => {
	const { session, user } = await safeGetSession();
	let displayName = '';
	let username: string | null = null;
	if (user) {
		const { data } = await supabase
			.from('profiles')
			.select('display_name, username')
			.eq('user_id', user.id)
			.single();
		displayName = data?.display_name ?? '';
		username = data?.username ?? null;
	}
	return {
		session,
		displayName,
		username,
		cookies: cookies.getAll()
	};
};
