BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(9);

SELECT ok(
	NOT has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
	'authenticated has no table-wide profile update privilege'
);
SELECT ok(
	has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
	'authenticated may update profile display names'
);
SELECT ok(
	has_column_privilege('authenticated', 'public.profiles', 'username', 'UPDATE'),
	'authenticated may update profile usernames'
);
SELECT ok(
	NOT has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
	'authenticated cannot target the profile role column'
);
SELECT ok(
	NOT has_column_privilege('authenticated', 'public.profiles', 'user_id', 'UPDATE'),
	'authenticated cannot target profile ownership'
);
SELECT ok(
	has_function_privilege('authenticated', 'public.ensure_game_rating(bigint)', 'EXECUTE'),
	'authenticated may initialize its own game rating'
);
SELECT ok(
	NOT has_function_privilege('anon', 'public.ensure_game_rating(bigint)', 'EXECUTE'),
	'anonymous users cannot initialize game ratings'
);
SELECT ok(
	NOT has_function_privilege(
		'authenticated',
		'public.apply_rating_result(bigint,bigint,uuid,uuid,double precision,text,jsonb,double precision,text,jsonb,double precision,jsonb,double precision,jsonb,text)',
		'EXECUTE'
	),
	'authenticated users cannot execute the privileged rating result RPC'
);
SELECT ok(
	has_function_privilege(
		'service_role',
		'public.apply_rating_result(bigint,bigint,uuid,uuid,double precision,text,jsonb,double precision,text,jsonb,double precision,jsonb,double precision,jsonb,text)',
		'EXECUTE'
	),
	'the service role can execute the atomic rating result RPC'
);

SELECT * FROM finish();

ROLLBACK;
