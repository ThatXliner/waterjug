import { redirect, fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';
export const actions: Actions = {
	create: async ({ request }) => {
		const formData = await request.formData();
		const name = formData.get('gameName') as string;
		// for some reason, we have to do this (bypass RLS)
		// XXX: eventually we need to make sure that only authenticated users
		// can insert or fix the RLS policies
		const { data, error } = await createClient<Database>(
			PUBLIC_SUPABASE_URL,
			SUPABASE_SERVICE_ROLE_KEY
		)
			.from('games')
			.insert([{ name }])
			.select();
		if (error != null) {
			return fail(400, { error, incorrect: true });
		}
		throw redirect(303, `/game/play/${data[0].game_id}`);
	}
};
