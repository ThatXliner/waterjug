BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path TO public, extensions;

SELECT plan(21);

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

SELECT ok(
	(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.game_invites'::regclass)
		AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.game_results'::regclass),
	'invites and peer results have RLS enabled'
);
SELECT ok(
	NOT has_table_privilege('authenticated', 'public.ratings', 'UPDATE,DELETE'),
	'clients cannot bypass peer confirmation with direct rating mutations'
);
SELECT ok(
	has_column_privilege('authenticated', 'public.games', 'invite_only', 'INSERT')
		AND NOT has_column_privilege('authenticated', 'public.games', 'game_id', 'INSERT')
		AND NOT has_column_privilege('authenticated', 'public.games', 'created_by', 'UPDATE')
		AND NOT has_column_privilege('authenticated', 'public.games', 'invite_only', 'UPDATE'),
	'game identity, ownership, visibility, and generated columns are immutable'
);
SELECT ok(
	has_column_privilege('authenticated', 'public.tournaments', 'status', 'INSERT,UPDATE')
		AND NOT has_column_privilege(
			'authenticated',
			'public.tournaments',
			'tournament_id',
			'INSERT,UPDATE'
		)
		AND NOT has_column_privilege('authenticated', 'public.tournaments', 'game_id', 'UPDATE')
		AND NOT has_column_privilege('authenticated', 'public.tournaments', 'created_by', 'UPDATE'),
	'tournament identity, game, creator, and generated columns are immutable'
);
SELECT ok(
	has_column_privilege(
		'authenticated',
		'public.tournament_participants',
		'tournament_id',
		'INSERT'
	)
		AND NOT has_column_privilege(
			'authenticated',
			'public.tournament_participants',
			'created_at',
			'INSERT'
		)
		AND NOT has_table_privilege(
			'authenticated',
			'public.tournament_participants',
			'UPDATE,DELETE'
		),
	'participant writes are limited to adding application identity columns'
);
SELECT ok(
	has_column_privilege('authenticated', 'public.game_invites', 'invited_email', 'INSERT')
		AND NOT has_column_privilege(
			'authenticated',
			'public.game_invites',
			'created_at',
			'INSERT'
		)
		AND has_table_privilege('authenticated', 'public.game_invites', 'DELETE')
		AND NOT has_table_privilege('authenticated', 'public.game_invites', 'UPDATE'),
	'invite writes are column-scoped and support owner revocation only'
);
SELECT ok(
	has_column_privilege('authenticated', 'public.game_results', 'submission_id', 'INSERT')
		AND NOT has_column_privilege('authenticated', 'public.game_results', 'status', 'INSERT')
		AND NOT has_column_privilege('authenticated', 'public.game_results', 'reviewed_by', 'INSERT')
		AND NOT has_table_privilege('authenticated', 'public.game_results', 'UPDATE,DELETE'),
	'result reports cannot choose snapshots, review state, or terminal transitions'
);
SELECT ok(
	has_function_privilege(
		'authenticated',
		'public.create_game(text,boolean,text[],jsonb)',
		'EXECUTE'
	)
		AND NOT has_function_privilege(
			'anon',
			'public.create_game(text,boolean,text[],jsonb)',
			'EXECUTE'
		),
	'only authenticated callers can enter the RLS-enforced game creation RPC'
);
SELECT ok(
	has_function_privilege(
		'service_role',
		'public.review_game_result(bigint,uuid,text,bigint,double precision,text,jsonb,double precision,text,jsonb)',
		'EXECUTE'
	)
		AND NOT has_function_privilege(
			'authenticated',
			'public.review_game_result(bigint,uuid,text,bigint,double precision,text,jsonb,double precision,text,jsonb)',
			'EXECUTE'
		),
	'only the service role can execute the peer-result review transition'
);
SELECT ok(
	NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
		AND NOT has_function_privilege(
			'authenticated',
			'public.prevent_profile_role_change()',
			'EXECUTE'
		)
		AND NOT has_function_privilege(
			'authenticated',
			'public.prepare_game_result()',
			'EXECUTE'
		),
	'trigger implementations are not callable as Data API RPCs'
);
SELECT is(
	(
		SELECT count(*)::integer
		FROM pg_proc
		WHERE oid = ANY (
			ARRAY[
				'public.handle_new_user()'::regprocedure,
				'public.prevent_profile_role_change()'::regprocedure,
				'public.ensure_game_rating(bigint)'::regprocedure,
				'public.create_game(text,boolean,text[],jsonb)'::regprocedure,
				'public.apply_rating_result(bigint,bigint,uuid,uuid,double precision,text,jsonb,double precision,text,jsonb,double precision,jsonb,double precision,jsonb,text)'::regprocedure,
				'public.prepare_game_result()'::regprocedure,
				'public.review_game_result(bigint,uuid,text,bigint,double precision,text,jsonb,double precision,text,jsonb)'::regprocedure,
				'private.enforce_game_rating_configuration_revision()'::regprocedure
			]
		)
			AND pg_get_userbyid(proowner) = 'postgres'
			AND proconfig = ARRAY['search_path=""']
	),
	8,
	'all audited functions are postgres-owned with empty search paths'
);
SELECT is(
	(
		SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname)
		FROM pg_proc AS p
		JOIN pg_namespace AS n ON n.oid = p.pronamespace
		WHERE p.prosecdef
			AND p.oid = ANY (
				ARRAY[
					'public.handle_new_user()'::regprocedure,
					'public.prevent_profile_role_change()'::regprocedure,
					'public.ensure_game_rating(bigint)'::regprocedure,
					'public.create_game(text,boolean,text[],jsonb)'::regprocedure,
					'public.apply_rating_result(bigint,bigint,uuid,uuid,double precision,text,jsonb,double precision,text,jsonb,double precision,jsonb,double precision,jsonb,text)'::regprocedure,
					'public.prepare_game_result()'::regprocedure,
					'public.review_game_result(bigint,uuid,text,bigint,double precision,text,jsonb,double precision,text,jsonb)'::regprocedure
				]
			)
	),
	ARRAY['public.handle_new_user', 'public.review_game_result'],
	'only the Auth trigger and service-only review transition are security-definer'
);

SELECT * FROM finish();

ROLLBACK;
