import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { Database } from '$lib/supabase';
import type { LayoutLoad } from './$types';
import { createBrowserClient } from '@supabase/ssr';

export const load: LayoutLoad = async ({ depends }) => {
	depends('supabase:auth');

	const supabase = createBrowserClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

	const {
		data: { session }
	} = await supabase.auth.getSession();

	return { supabase, session };
};
