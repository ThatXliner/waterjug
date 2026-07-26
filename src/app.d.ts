import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { AppRole } from '$lib/roles';
import type { Database } from '$lib/supabase';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient<Database>;
			safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
			session: Session | null;
			user: User | null;
			role: AppRole | null;
		}
		interface PageData {
			session: Session | null;
			role: AppRole | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
