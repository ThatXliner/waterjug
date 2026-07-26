import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private';
import type { Database } from '$lib/supabase';

let privilegedClient: SupabaseClient<Database> | undefined;

/**
 * Returns the service-role client for operations that must bypass RLS.
 *
 * Keeping this factory under `$lib/server` prevents the service key and the
 * privileged client from being imported into browser code.
 */
export function getPrivilegedSupabase(): SupabaseClient<Database> {
	privilegedClient ??= createClient<Database>(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
		auth: {
			autoRefreshToken: false,
			persistSession: false
		}
	});

	return privilegedClient;
}
