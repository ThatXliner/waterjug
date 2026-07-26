begin;

select plan(14);

insert into auth.users (
	id,
	instance_id,
	aud,
	role,
	email,
	encrypted_password,
	email_confirmed_at,
	raw_app_meta_data,
	raw_user_meta_data,
	created_at,
	updated_at
)
values
	(
		'00000000-0000-0000-0000-000000000001',
		'00000000-0000-0000-0000-000000000000',
		'authenticated',
		'authenticated',
		'owner@example.com',
		'',
		now(),
		'{}',
		'{}',
		now(),
		now()
	),
	(
		'00000000-0000-0000-0000-000000000002',
		'00000000-0000-0000-0000-000000000000',
		'authenticated',
		'authenticated',
		'invited@example.com',
		'',
		now(),
		'{}',
		'{}',
		now(),
		now()
	),
	(
		'00000000-0000-0000-0000-000000000003',
		'00000000-0000-0000-0000-000000000000',
		'authenticated',
		'authenticated',
		'outsider@example.com',
		'',
		now(),
		'{}',
		'{}',
		now(),
		now()
	);

set local role authenticated;
set local request.jwt.claims =
	'{"sub":"00000000-0000-0000-0000-000000000001","email":"owner@example.com","role":"authenticated"}';

select lives_ok(
	$$select public.create_game('Private test game', true, array['Invited@Example.com'])$$,
	'an authenticated user can create an invite-only game'
);
select lives_ok(
	$$select public.create_game('Public test game', false, array[]::text[])$$,
	'an authenticated user can create a public game'
);
select is(
	(select count(*)::integer from public.games where name = 'Private test game'),
	1,
	'the creator can view the invite-only game'
);
select is(
	(
		select invited_email
		from public.game_invites
		where game_id = (select game_id from public.games where name = 'Private test game')
	),
	'invited@example.com',
	'invitation emails are normalized'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
	'{"sub":"00000000-0000-0000-0000-000000000003","email":"outsider@example.com","role":"authenticated"}';

select is(
	(select count(*)::integer from public.games where name = 'Private test game'),
	0,
	'an uninvited user cannot view the invite-only game'
);
select throws_ok(
	format(
		'insert into public.ratings (game_id, user_id) values (%s, %L)',
		(select game_id from public.games where name = 'Public test game') - 1,
		'00000000-0000-0000-0000-000000000003'
	),
	'42501',
	null,
	'an uninvited user cannot join the invite-only game'
);
select throws_ok(
	format(
		'select public.ensure_game_rating(%s)',
		(select game_id from public.games where name = 'Public test game') - 1
	),
	'42501',
	null,
	'the join RPC clearly denies access without disclosing the inaccessible game'
);
select is(
	(
		select count(*)::integer
		from public.ratings
		where user_id = '00000000-0000-0000-0000-000000000003'
			and game_id = (select game_id from public.games where name = 'Public test game') - 1
	),
	0,
	'the join RPC cannot create an uninvited rating'
);
select lives_ok(
	format(
		'insert into public.ratings (game_id, user_id) values (%s, %L)',
		(select game_id from public.games where name = 'Public test game'),
		'00000000-0000-0000-0000-000000000003'
	),
	'any authenticated user can still join a public game'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is(
	(select count(*)::integer from public.games where name = 'Public test game'),
	1,
	'an unauthenticated visitor can still view a public game'
);
select is(
	(select count(*)::integer from public.games where name = 'Private test game'),
	0,
	'an unauthenticated visitor cannot view an invite-only game'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
	'{"sub":"00000000-0000-0000-0000-000000000002","email":"invited@example.com","role":"authenticated"}';

select is(
	(select count(*)::integer from public.games where name = 'Private test game'),
	1,
	'an invited user can view the invite-only game'
);
select lives_ok(
	format(
		'select public.ensure_game_rating(%s)',
		(select game_id from public.games where name = 'Private test game')
	),
	'an invited user can join the invite-only game through the atomic RPC'
);
select is(
	(
		select rating::integer
		from public.ratings
		where game_id = (select game_id from public.games where name = 'Private test game')
			and user_id = '00000000-0000-0000-0000-000000000002'
	),
	1200,
	'the invited join snapshots the configured default rating'
);

select * from finish();
rollback;
