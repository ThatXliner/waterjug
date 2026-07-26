begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

create or replace function pg_temp.rating_configuration(
  default_rating double precision default 1200,
  period_days double precision default 1,
  initial_deviation double precision default 350,
  max_deviation double precision default 350,
  deviation_increase double precision default 63.2,
  glicko_scale double precision default 400,
  k_factor double precision default 32,
  elo_scale double precision default 400,
  formula text default 'rating + 32 * (score - expected)'
)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'version', 1,
    'system', 'glicko',
    'defaultRating', default_rating,
    'periodDays', period_days,
    'glicko', jsonb_build_object(
      'initialDeviation', initial_deviation,
      'maxDeviation', max_deviation,
      'periodDeviationIncrease', deviation_increase,
      'scale', glicko_scale
    ),
    'elo', jsonb_build_object(
      'kFactor', k_factor,
      'scale', elo_scale
    ),
    'custom', jsonb_build_object('formula', formula)
  )
$$;

select ok(
  not has_function_privilege(
    'anon',
    'private.enforce_game_rating_configuration_revision()',
    'execute'
  )
    and not has_function_privilege(
      'authenticated',
      'private.enforce_game_rating_configuration_revision()',
      'execute'
    ),
  'the revision trigger implementation is not exposed as an RPC'
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
    '55555555-5555-4555-8555-555555555555',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rating-config-owner@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'rating-config-other@example.test',
    '',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

insert into public.games (
  game_id,
  name,
  created_by,
  rating_configuration
)
values (
  940001,
  'Rating configuration restriction fixture',
  '55555555-5555-4555-8555-555555555555',
  pg_temp.rating_configuration()
);

set local role service_role;
update public.profiles
set role = 'admin'
where user_id = '55555555-5555-4555-8555-555555555555';
reset role;

set local role authenticated;
set local "request.jwt.claim.sub" = '55555555-5555-4555-8555-555555555555';

select lives_ok(
  $test$
    insert into public.games (name, created_by, rating_configuration)
    values (
      'Owner configuration',
      '55555555-5555-4555-8555-555555555555',
      pg_temp.rating_configuration()
    )
  $test$,
  'an owner can create a game with a valid rating configuration'
);

select lives_ok(
  $test$
    update public.games
    set rating_configuration =
          jsonb_set(rating_configuration, '{defaultRating}', '1300'::jsonb),
        rating_configuration_revision = 2
    where game_id = 940001
  $test$,
  'an owner can atomically update a configuration and advance its revision'
);

reset "request.jwt.claim.sub";
set local "request.jwt.claim.sub" = '66666666-6666-4666-8666-666666666666';

select results_eq(
  $test$
    update public.games
    set rating_configuration =
          jsonb_set(rating_configuration, '{defaultRating}', '1400'::jsonb),
        rating_configuration_revision = 3
    where game_id = 940001
    returning game_id
  $test$,
  $$values (1::bigint) limit 0$$,
  'another user cannot update a game rating configuration'
);

reset "request.jwt.claim.sub";
set local "request.jwt.claim.sub" = '55555555-5555-4555-8555-555555555555';

select throws_ok(
  $$update public.games set name = 'Renamed through configuration policy' where game_id = 940001$$,
  '42501',
  null,
  'the configuration policy cannot be used to rename a game'
);

select throws_ok(
  $$update public.games set created_by = '66666666-6666-4666-8666-666666666666' where game_id = 940001$$,
  '42501',
  null,
  'the configuration policy cannot transfer game ownership'
);

select throws_ok(
  $test$
    update public.games
    set rating_configuration =
          jsonb_set(rating_configuration, '{defaultRating}', '1400'::jsonb)
    where game_id = 940001
  $test$,
  '23514',
  null,
  'a configuration change without a revision increment is rejected'
);

select throws_ok(
  $$update public.games set rating_configuration_revision = 3 where game_id = 940001$$,
  '23514',
  null,
  'a revision change without a configuration change is rejected'
);

select throws_ok(
  $test$
    update public.games
    set rating_configuration =
          jsonb_set(rating_configuration, '{defaultRating}', '1400'::jsonb),
        rating_configuration_revision = 4
    where game_id = 940001
  $test$,
  '23514',
  null,
  'a configuration revision cannot skip a compare-and-set generation'
);

select lives_ok(
  $test$
    do $do$
    declare
      valid_configuration jsonb := pg_temp.rating_configuration();
      invalid_configuration jsonb;
    begin
      foreach invalid_configuration in array array[
        'null'::jsonb,
        '{}'::jsonb,
        '[]'::jsonb,
        valid_configuration || '{"unexpected": true}'::jsonb,
        valid_configuration #- '{elo}',
        jsonb_set(
          valid_configuration,
          '{glicko}',
          valid_configuration->'glicko' || '{"unexpected": true}'::jsonb
        )
      ] loop
        begin
          insert into public.games (name, created_by, rating_configuration)
          values (
            'Malformed configuration shape',
            '55555555-5555-4555-8555-555555555555',
            invalid_configuration
          );
          raise exception 'malformed rating configuration shape accepted: %',
            invalid_configuration;
        exception
          when check_violation or not_null_violation
            or invalid_text_representation or numeric_value_out_of_range then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated missing, null, array, and extra-key configuration shapes are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      valid_configuration jsonb := pg_temp.rating_configuration();
      invalid_configuration jsonb;
    begin
      foreach invalid_configuration in array array[
        jsonb_set(valid_configuration, '{version}', '1.4'::jsonb),
        jsonb_set(valid_configuration, '{defaultRating}', '-1'::jsonb),
        jsonb_set(valid_configuration, '{defaultRating}', '1000001'::jsonb),
        jsonb_set(valid_configuration, '{periodDays}', '0'::jsonb),
        jsonb_set(valid_configuration, '{periodDays}', '3651'::jsonb),
        jsonb_set(valid_configuration, '{glicko,initialDeviation}', '351'::jsonb),
        jsonb_set(valid_configuration, '{glicko,scale}', '0'::jsonb),
        jsonb_set(valid_configuration, '{elo,kFactor}', '0'::jsonb),
        jsonb_set(valid_configuration, '{elo,scale}', '10001'::jsonb)
      ] loop
        begin
          insert into public.games (name, created_by, rating_configuration)
          values (
            'Malformed configuration number',
            '55555555-5555-4555-8555-555555555555',
            invalid_configuration
          );
          raise exception 'out-of-range rating configuration accepted: %',
            invalid_configuration;
        exception
          when check_violation or invalid_text_representation
            or numeric_value_out_of_range then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated fractional-version and out-of-range numeric configurations are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      valid_configuration jsonb := pg_temp.rating_configuration();
      invalid_configuration jsonb;
    begin
      foreach invalid_configuration in array array[
        jsonb_set(valid_configuration, '{system}', '"unknown"'::jsonb),
        jsonb_set(valid_configuration, '{system}', '1'::jsonb),
        jsonb_set(valid_configuration, '{custom,formula}', '""'::jsonb),
        jsonb_set(valid_configuration, '{custom,formula}', '" \t\n "'::jsonb),
        jsonb_set(
          valid_configuration,
          '{custom,formula}',
          to_jsonb(repeat('x', 501))
        )
      ] loop
        begin
          insert into public.games (name, created_by, rating_configuration)
          values (
            'Malformed configuration string',
            '55555555-5555-4555-8555-555555555555',
            invalid_configuration
          );
          raise exception 'invalid rating configuration string accepted: %',
            invalid_configuration;
        exception
          when check_violation or invalid_text_representation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated invalid systems and formula string boundaries are rejected'
);

select lives_ok(
  $test$
    insert into public.games (name, created_by, rating_configuration)
    values (
      'Lower configuration boundaries',
      '55555555-5555-4555-8555-555555555555',
      pg_temp.rating_configuration(
        0,
        1.0 / 24.0,
        1,
        1,
        0,
        1,
        0.01,
        1
      )
    )
  $test$,
  'all lower numeric rating configuration boundaries remain valid'
);

select lives_ok(
  $test$
    insert into public.games (name, created_by, rating_configuration)
    values (
      'Upper configuration boundaries',
      '55555555-5555-4555-8555-555555555555',
      pg_temp.rating_configuration(
        1000000,
        3650,
        1000,
        1000,
        1000,
        10000,
        1000,
        10000,
        repeat('x', 500)
      )
    )
  $test$,
  'all upper numeric and formula-length boundaries remain valid'
);

select results_eq(
  $$select rating_configuration_revision from public.games where game_id = 940001$$,
  array[2::bigint],
  'failed updates leave the committed configuration revision unchanged'
);

select results_eq(
  $$select (rating_configuration->>'defaultRating')::double precision from public.games where game_id = 940001$$,
  array[1300::double precision],
  'failed updates leave the committed rating configuration unchanged'
);

reset role;

select * from finish();
rollback;
