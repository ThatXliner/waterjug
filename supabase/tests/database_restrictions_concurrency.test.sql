begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(17);

select extensions.dblink_connect(
  'race_setup',
  'host=db port=5432 dbname=postgres user=postgres password=postgres'
);

-- These fixtures must be committed so independent race sessions can see them.
select extensions.dblink_exec(
  'race_setup',
  $setup$
    delete from public.games where game_id = 930001;
    delete from auth.users
    where id in (
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    );

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
        '33333333-3333-4333-8333-333333333333',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'database-race-owner@example.test',
        '',
        now(),
        '{}',
        '{}',
        now(),
        now()
      ),
      (
        '44444444-4444-4444-8444-444444444444',
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        'database-race-other@example.test',
        '',
        now(),
        '{}',
        '{}',
        now(),
        now()
      );

    insert into public.games (game_id, name, created_by)
    values (
      930001,
      'Concurrent restriction fixture',
      '33333333-3333-4333-8333-333333333333'
    );

    insert into public.tournaments (
      tournament_id,
      game_id,
      name,
      type,
      created_by
    )
    values (
      930001,
      930001,
      'Concurrent restriction fixture',
      'round_robin',
      '33333333-3333-4333-8333-333333333333'
    )
  $setup$
);

select extensions.dblink_connect(
  'race_owner',
  'host=db port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'race_other',
  'host=db port=5432 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'race_owner_b',
  'host=db port=5432 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec('race_owner', 'begin');
select extensions.dblink_exec('race_owner', 'set local role authenticated');
select extensions.dblink_exec(
  'race_owner',
  $sql$
    set local "request.jwt.claim.sub" =
      '33333333-3333-4333-8333-333333333333'
  $sql$
);
select extensions.dblink_exec('race_other', 'begin');
select extensions.dblink_exec('race_other', 'set local role authenticated');
select extensions.dblink_exec(
  'race_other',
  $sql$
    set local "request.jwt.claim.sub" =
      '44444444-4444-4444-8444-444444444444'
  $sql$
);
select extensions.dblink_exec('race_other', $$set local lock_timeout = '750ms'$$);

-- Hold a write lock as the owner, then prove a non-owner cannot race an update
-- through the policy and does not wait on a row it is forbidden to modify.
select is(
  extensions.dblink_exec(
    'race_owner',
    $$update public.tournaments set status = 'active' where tournament_id = 930001$$
  ),
  'UPDATE 1',
  'the owner acquires the tournament update lock'
);
select is(
  extensions.dblink_exec(
    'race_other',
    $$update public.tournaments set status = 'completed' where tournament_id = 930001$$
  ),
  'UPDATE 0',
  'a concurrent non-owner update is filtered without waiting on the owner lock'
);

-- The same policy must fail before an unauthorized insert can contend with an
-- authorized insert for the participant primary key.
select is(
  extensions.dblink_exec(
    'race_owner',
    $sql$
      insert into public.tournament_participants (tournament_id, user_id)
      values (930001, '44444444-4444-4444-8444-444444444444')
    $sql$
  ),
  'INSERT 0 1',
  'the creator can insert a participant while holding the transaction open'
);
select throws_ok(
  $test$
    select extensions.dblink_exec(
      'race_other',
      $sql$
        insert into public.tournament_participants (tournament_id, user_id)
        values (930001, '44444444-4444-4444-8444-444444444444')
      $sql$
    )
  $test$,
  '42501',
  null,
  'a concurrent non-creator insert fails RLS instead of winning the race'
);

select extensions.dblink_exec('race_other', 'rollback');
select extensions.dblink_exec('race_owner', 'commit');

select results_eq(
  $query$
    select status
    from extensions.dblink(
      'race_setup',
      $$select status from public.tournaments where tournament_id = 930001$$
    ) as result(status text)
  $query$,
  array['active'::text],
  'the unauthorized transition did not overwrite the committed owner state'
);
select results_eq(
  $query$
    select count(*)::bigint
    from extensions.dblink(
      'race_setup',
      $sql$
        select tournament_id
        from public.tournament_participants
        where tournament_id = 930001
          and user_id = '44444444-4444-4444-8444-444444444444'
      $sql$
    ) as result(tournament_id bigint)
  $query$,
  array[1::bigint],
  'exactly one participant row survives the authorized/unauthorized race'
);

-- Two authorized sessions racing the same logical insert must serialize on the
-- composite primary key. The first commit wins and the second fails rather
-- than creating a duplicate.
select extensions.dblink_exec('race_owner', 'begin');
select extensions.dblink_exec('race_owner', 'set local role authenticated');
select extensions.dblink_exec(
  'race_owner',
  $sql$
    set local "request.jwt.claim.sub" =
      '33333333-3333-4333-8333-333333333333'
  $sql$
);
select extensions.dblink_exec('race_owner_b', 'begin');
select extensions.dblink_exec('race_owner_b', 'set local role authenticated');
select extensions.dblink_exec(
  'race_owner_b',
  $sql$
    set local "request.jwt.claim.sub" =
      '33333333-3333-4333-8333-333333333333'
  $sql$
);

select is(
  extensions.dblink_exec(
    'race_owner',
    $sql$
      insert into public.tournament_participants (tournament_id, user_id)
      values (930001, '33333333-3333-4333-8333-333333333333')
    $sql$
  ),
  'INSERT 0 1',
  'the first authorized transaction inserts the participant'
);
select is(
  extensions.dblink_send_query(
    'race_owner_b',
    $sql$
      insert into public.tournament_participants (tournament_id, user_id)
      values (930001, '33333333-3333-4333-8333-333333333333')
    $sql$
  ),
  1,
  'the competing authorized insert starts asynchronously'
);
select is(
  extensions.dblink_is_busy('race_owner_b'),
  1,
  'the competing insert waits for the uncommitted primary-key conflict'
);
select extensions.dblink_exec('race_owner', 'commit');
select throws_ok(
  $test$
    select *
    from extensions.dblink_get_result('race_owner_b') as result(status text)
  $test$,
  '23505',
  null,
  'the losing authorized transaction fails with a uniqueness violation'
);
select extensions.dblink_exec('race_owner_b', 'rollback');
select results_eq(
  $query$
    select count(*)::bigint
    from extensions.dblink(
      'race_setup',
      $sql$
        select tournament_id
        from public.tournament_participants
        where tournament_id = 930001
          and user_id = '33333333-3333-4333-8333-333333333333'
      $sql$
    ) as result(tournament_id bigint)
  $query$,
  array[1::bigint],
  'exactly one row survives the authorized duplicate-insert race'
);

-- Rating configuration updates use the revision as a compare-and-set token.
-- A non-owner must be filtered before contending on the owner lock, while two
-- owner sessions starting from the same revision must serialize to one winner.
select extensions.dblink_exec('race_owner', 'begin');
select extensions.dblink_exec('race_owner', 'set local role authenticated');
select extensions.dblink_exec(
  'race_owner',
  $sql$
    set local "request.jwt.claim.sub" =
      '33333333-3333-4333-8333-333333333333'
  $sql$
);
select extensions.dblink_exec('race_other', 'begin');
select extensions.dblink_exec('race_other', 'set local role authenticated');
select extensions.dblink_exec(
  'race_other',
  $sql$
    set local "request.jwt.claim.sub" =
      '44444444-4444-4444-8444-444444444444'
  $sql$
);
select extensions.dblink_exec('race_other', $$set local lock_timeout = '750ms'$$);
select extensions.dblink_exec('race_owner_b', 'begin');
select extensions.dblink_exec('race_owner_b', 'set local role authenticated');
select extensions.dblink_exec(
  'race_owner_b',
  $sql$
    set local "request.jwt.claim.sub" =
      '33333333-3333-4333-8333-333333333333'
  $sql$
);

select is(
  extensions.dblink_exec(
    'race_owner',
    $sql$
      update public.games
      set rating_configuration =
            jsonb_set(rating_configuration, '{defaultRating}', '1300'::jsonb),
          rating_configuration_revision = 2
      where game_id = 930001
        and rating_configuration_revision = 1
    $sql$
  ),
  'UPDATE 1',
  'the first owner locks and advances the expected configuration revision'
);
select is(
  extensions.dblink_exec(
    'race_other',
    $sql$
      update public.games
      set rating_configuration =
            jsonb_set(rating_configuration, '{defaultRating}', '9000'::jsonb),
          rating_configuration_revision = 2
      where game_id = 930001
        and rating_configuration_revision = 1
    $sql$
  ),
  'UPDATE 0',
  'a non-owner configuration update is filtered without waiting on the owner lock'
);
select is(
  extensions.dblink_send_query(
    'race_owner_b',
    $sql$
      update public.games
      set rating_configuration =
            jsonb_set(rating_configuration, '{defaultRating}', '1400'::jsonb),
          rating_configuration_revision = 2
      where game_id = 930001
        and rating_configuration_revision = 1
    $sql$
  ),
  1,
  'a competing owner configuration update starts asynchronously'
);
select is(
  extensions.dblink_is_busy('race_owner_b'),
  1,
  'the competing owner update waits on the uncommitted revision'
);
select extensions.dblink_exec('race_owner', 'commit');
select results_eq(
  $query$
    select status
    from extensions.dblink_get_result('race_owner_b') as result(status text)
  $query$,
  array['UPDATE 0'::text],
  'the stale owner compare-and-set loses after the winning revision commits'
);
select extensions.dblink_exec('race_owner_b', 'commit');
select extensions.dblink_exec('race_other', 'rollback');
select results_eq(
  $query$
    select state
    from extensions.dblink(
      'race_setup',
      $sql$
        select
          rating_configuration_revision::text
          || ':'
          || (rating_configuration->>'defaultRating')
        from public.games
        where game_id = 930001
      $sql$
    ) as result(state text)
  $query$,
  array['2:1300'::text],
  'exactly the winning owner configuration and revision remain committed'
);

select extensions.dblink_disconnect('race_owner');
select extensions.dblink_disconnect('race_other');
select extensions.dblink_disconnect('race_owner_b');

select extensions.dblink_exec(
  'race_setup',
  $cleanup$
    delete from public.games where game_id = 930001;
    delete from auth.users
    where id in (
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    )
  $cleanup$
);
select extensions.dblink_disconnect('race_setup');

select * from finish();
rollback;
