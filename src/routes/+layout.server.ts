import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals: { safeGetSession, supabase }, cookies }) => {
	const { session, user } = await safeGetSession();
	let displayName = '';
	if (user) {
		const { data } = await supabase
			.from('profiles')
			.select('display_name')
			.eq('user_id', user.id)
			.single();
		displayName = data?.display_name ?? '';
	}
	return {
		session,
		displayName,
		cookies: cookies.getAll()
	};
};
