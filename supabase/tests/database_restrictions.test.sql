begin;

create extension if not exists pgtap with schema extensions;

select plan(44);

-- The five application tables are all exposed through the public schema, so
-- every one must have RLS enabled.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.games'::regclass),
  'games has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ratings'::regclass),
  'ratings has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tournaments'::regclass),
  'tournaments has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tournament_participants'::regclass),
  'tournament_participants has RLS enabled'
);

-- Public data is readable, but anonymous callers have no write privileges.
select ok(has_table_privilege('anon', 'public.games', 'select'), 'anon can read games');
select ok(has_table_privilege('anon', 'public.profiles', 'select'), 'anon can read profiles');
select ok(has_table_privilege('anon', 'public.ratings', 'select'), 'anon can read ratings');
select ok(has_table_privilege('anon', 'public.tournaments', 'select'), 'anon can read tournaments');
select ok(
  has_table_privilege('anon', 'public.tournament_participants', 'select'),
  'anon can read tournament participants'
);
select ok(
  not has_table_privilege('anon', 'public.games', 'insert,update,delete'),
  'anon cannot write games'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'insert,update,delete'),
  'anon cannot write profiles'
);
select ok(
  not has_table_privilege('anon', 'public.ratings', 'insert,update,delete'),
  'anon cannot write ratings'
);
select ok(
  not has_table_privilege('anon', 'public.tournaments', 'insert,update,delete'),
  'anon cannot write tournaments'
);
select ok(
  not has_table_privilege(
    'anon',
    'public.tournament_participants',
    'insert,update,delete'
  ),
  'anon cannot write tournament participants'
);

-- Authenticated privileges are deliberately narrower than ALL.
select ok(
  has_table_privilege('authenticated', 'public.games', 'select,insert')
    and not has_table_privilege('authenticated', 'public.games', 'update,delete'),
  'authenticated users can read and create games only'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'update'),
  'authenticated users can update display names'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'created_at', 'update')
    and not has_column_privilege('authenticated', 'public.profiles', 'user_id', 'update'),
  'immutable profile columns cannot be updated'
);
select ok(
  has_table_privilege('authenticated', 'public.ratings', 'select,insert,update')
    and not has_table_privilege('authenticated', 'public.ratings', 'delete'),
  'authenticated users can read, add, and update ratings but not delete them'
);
select ok(
  has_table_privilege('authenticated', 'public.tournaments', 'select,insert,update')
    and not has_table_privilege('authenticated', 'public.tournaments', 'delete'),
  'authenticated users can read, add, and update tournaments but not delete them'
);
select ok(
  has_table_privilege(
    'authenticated',
    'public.tournament_participants',
    'select,insert'
  )
    and not has_table_privilege(
      'authenticated',
      'public.tournament_participants',
      'update,delete'
    ),
  'authenticated users can read and add tournament participants only'
);

select ok(
  not has_function_privilege('anon', 'public.handle_new_user()', 'execute')
    and not has_function_privilege(
      'authenticated',
      'public.handle_new_user()',
      'execute'
    ),
  'the Auth trigger function is not exposed as an RPC'
);
select is(
  (select proconfig from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
  array['search_path=""'],
  'the security-definer trigger has an empty search path'
);

-- Create two real Auth identities. The Auth trigger creates their profile rows.
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
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'database-owner@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'database-other@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

insert into public.games (game_id, name)
values (900001, 'Database restriction fixture');

insert into public.ratings (game_id, user_id)
values
  (900001, '11111111-1111-4111-8111-111111111111'),
  (900001, '22222222-2222-4222-8222-222222222222');

insert into public.tournaments (
  tournament_id,
  game_id,
  name,
  type,
  created_by
)
values (
  900001,
  900001,
  'Database restriction fixture',
  'round_robin',
  '11111111-1111-4111-8111-111111111111'
);

insert into public.tournament_participants (tournament_id, user_id)
values (900001, '11111111-1111-4111-8111-111111111111');

set local role anon;

select results_eq(
  $$select count(*)::bigint from public.games where game_id = 900001$$,
  array[1::bigint],
  'anon can read a game'
);
select results_eq(
  $$select count(*)::bigint from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'$$,
  array[1::bigint],
  'anon can read a public profile'
);
select results_eq(
  $$select count(*)::bigint from public.ratings where game_id = 900001$$,
  array[2::bigint],
  'anon can read ratings'
);
select results_eq(
  $$select count(*)::bigint from public.tournaments where tournament_id = 900001$$,
  array[1::bigint],
  'anon can read tournaments'
);
select results_eq(
  $$select count(*)::bigint from public.tournament_participants where tournament_id = 900001$$,
  array[1::bigint],
  'anon can read tournament participants'
);
select throws_ok(
  $$insert into public.games (name) values ('anonymous game')$$,
  '42501',
  null,
  'anon cannot create a game'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';

select lives_ok(
  $$insert into public.games (name) values ('owner-created game')$$,
  'an authenticated user can create a game'
);
select lives_ok(
  $$update public.profiles set display_name = 'Owner' where user_id = '11111111-1111-4111-8111-111111111111'$$,
  'a user can update their own display name'
);
select results_eq(
  $$update public.profiles set display_name = 'Stolen' where user_id = '22222222-2222-4222-8222-222222222222' returning 1$$,
  $$values (1) limit 0$$,
  'a user cannot update another profile'
);
select throws_ok(
  $$update public.profiles set created_at = now() where user_id = '11111111-1111-4111-8111-111111111111'$$,
  '42501',
  null,
  'a user cannot update protected profile columns'
);
select lives_ok(
  $$update public.ratings set rating = 1250 where game_id = 900001 and user_id = '11111111-1111-4111-8111-111111111111'$$,
  'a user can update their own rating'
);
select results_eq(
  $$update public.ratings set rating = 9999 where game_id = 900001 and user_id = '22222222-2222-4222-8222-222222222222' returning 1$$,
  $$values (1) limit 0$$,
  'a user cannot update another rating'
);
select throws_ok(
  $$insert into public.ratings (game_id, user_id) values (900001, '22222222-2222-4222-8222-222222222222')$$,
  '42501',
  null,
  'a user cannot insert a rating for another user'
);
select lives_ok(
  $$insert into public.tournaments (game_id, name, type, created_by) values (900001, 'Owner tournament', 'bracket', '11111111-1111-4111-8111-111111111111')$$,
  'a user can create a tournament they own'
);
select throws_ok(
  $$insert into public.tournaments (game_id, name, type, created_by) values (900001, 'Spoofed tournament', 'bracket', '22222222-2222-4222-8222-222222222222')$$,
  '42501',
  null,
  'a user cannot create a tournament for another user'
);
select lives_ok(
  $$update public.tournaments set status = 'active' where tournament_id = 900001$$,
  'a tournament creator can update their tournament'
);
select lives_ok(
  $$insert into public.tournament_participants (tournament_id, user_id) values (900001, '22222222-2222-4222-8222-222222222222')$$,
  'a tournament creator can add a participant'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';

select results_eq(
  $$update public.tournaments set status = 'completed' where tournament_id = 900001 returning 1$$,
  $$values (1) limit 0$$,
  'another user cannot update a tournament'
);
select throws_ok(
  $$insert into public.tournament_participants (tournament_id, user_id) values (900001, '22222222-2222-4222-8222-222222222222')$$,
  '42501',
  null,
  'another user cannot add tournament participants'
);
select throws_ok(
  $$delete from public.ratings where game_id = 900001 and user_id = '22222222-2222-4222-8222-222222222222'$$,
  '42501',
  null,
  'authenticated users cannot delete ratings'
);

reset role;
set local role authenticated;
reset "request.jwt.claim.sub";

select throws_ok(
  $$insert into public.games (name) values ('missing identity')$$,
  '42501',
  null,
  'the authenticated role without a user identity cannot create a game'
);

reset role;

select * from finish();
rollback;
