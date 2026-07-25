begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- Generate enough principals to exercise every owner/non-owner pairing instead
-- of validating only one hand-picked pair.
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
select
  format(
    '00000000-0000-4000-8000-%s',
    lpad(principal::text, 12, '0')
  )::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  format('database-matrix-%s@example.test', principal),
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
from generate_series(1, 8) as principal;

insert into public.games (game_id, name)
values (920001, 'Generated authorization matrix');

insert into public.ratings (game_id, user_id)
select
  920001,
  format(
    '00000000-0000-4000-8000-%s',
    lpad(principal::text, 12, '0')
  )::uuid
from generate_series(1, 8) as principal;

insert into public.tournaments (
  tournament_id,
  game_id,
  name,
  type,
  created_by
)
select
  920000 + principal,
  920001,
  format('Matrix tournament %s', principal),
  'round_robin',
  format(
    '00000000-0000-4000-8000-%s',
    lpad(principal::text, 12, '0')
  )::uuid
from generate_series(1, 8) as principal;

create or replace function pg_temp.authorization_matrix_holds()
returns boolean
language plpgsql
as $$
declare
  actor_number integer;
  owner_number integer;
  actor_id uuid;
  owner_id uuid;
  affected integer;
  should_succeed boolean;
begin
  for actor_number in 1..8 loop
    actor_id := format(
      '00000000-0000-4000-8000-%s',
      lpad(actor_number::text, 12, '0')
    )::uuid;
    perform set_config('request.jwt.claim.sub', actor_id::text, true);

    for owner_number in 1..8 loop
      owner_id := format(
        '00000000-0000-4000-8000-%s',
        lpad(owner_number::text, 12, '0')
      )::uuid;
      should_succeed := actor_id = owner_id;

      update public.profiles
      set display_name = format('actor-%s', actor_number)
      where user_id = owner_id;
      get diagnostics affected = row_count;
      if affected <> should_succeed::integer then
        raise notice 'profile mismatch: actor %, owner %, rows %',
          actor_number, owner_number, affected;
        return false;
      end if;

      update public.ratings
      set rating = 1200 + actor_number
      where game_id = 920001
        and user_id = owner_id;
      get diagnostics affected = row_count;
      if affected <> should_succeed::integer then
        raise notice 'rating mismatch: actor %, owner %, rows %',
          actor_number, owner_number, affected;
        return false;
      end if;

      update public.tournaments
      set name = format('actor-%s-owner-%s', actor_number, owner_number)
      where tournament_id = 920000 + owner_number;
      get diagnostics affected = row_count;
      if affected <> should_succeed::integer then
        raise notice 'tournament update mismatch: actor %, owner %, rows %',
          actor_number, owner_number, affected;
        return false;
      end if;

      begin
        insert into public.tournaments (
          game_id,
          name,
          type,
          created_by
        )
        values (
          920001,
          format('actor-%s-claims-owner-%s', actor_number, owner_number),
          'bracket',
          owner_id
        );

        if not should_succeed then
          raise notice 'forged tournament accepted: actor %, owner %',
            actor_number, owner_number;
          return false;
        end if;
      exception
        when insufficient_privilege then
          if should_succeed then
            raise notice 'owned tournament rejected: actor %', actor_number;
            return false;
          end if;
      end;

      begin
        insert into public.tournament_participants (
          tournament_id,
          user_id
        )
        values (920000 + owner_number, actor_id);

        if not should_succeed then
          raise notice 'foreign participant accepted: actor %, owner %',
            actor_number, owner_number;
          return false;
        end if;
      exception
        when insufficient_privilege then
          if should_succeed then
            raise notice 'owned participant rejected: actor %', actor_number;
            return false;
          end if;
      end;
    end loop;
  end loop;

  return true;
end
$$;

set local role authenticated;

select ok(
  pg_temp.authorization_matrix_holds(),
  'generated 8x8 actor/owner matrix preserves all ownership policies'
);

select results_eq(
  $$select count(*)::bigint from public.games where game_id = 920001$$,
  array[1::bigint],
  'public reads remain available when an authenticated role has no JWT claim'
);

set local "request.jwt.claim.sub" = 'not-a-uuid';

select throws_ok(
  $$insert into public.games (name) values ('malformed identity')$$,
  '22P02',
  null,
  'a malformed JWT subject fails closed'
);

set local "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';

select lives_ok(
  $test$
    do $do$
    declare
      bad_name text;
    begin
      foreach bad_name in array array['', ' ', E'\t', E'\n', E' \t\n ', null] loop
        begin
          insert into public.games (name) values (bad_name);
          raise exception 'blank game name accepted';
        exception
          when check_violation or not_null_violation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated blank and whitespace-only game names are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      bad_name text;
    begin
      foreach bad_name in array array['', ' ', E'\t', E'\n', E' \t\n ', null] loop
        begin
          insert into public.tournaments (
            game_id,
            name,
            type,
            created_by
          )
          values (
            920001,
            bad_name,
            'bracket',
            '00000000-0000-4000-8000-000000000001'
          );
          raise exception 'blank tournament name accepted';
        exception
          when check_violation or not_null_violation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated blank and whitespace-only tournament names are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      bad_type text;
    begin
      foreach bad_type in array array[
        '',
        'BRACKET',
        'single_elimination',
        ' bracket ',
        null
      ] loop
        begin
          insert into public.tournaments (
            game_id,
            name,
            type,
            created_by
          )
          values (
            920001,
            'Bad type',
            bad_type,
            '00000000-0000-4000-8000-000000000001'
          );
          raise exception 'invalid tournament type accepted: %', bad_type;
        exception
          when check_violation or not_null_violation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated malformed tournament types are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      bad_status text;
    begin
      foreach bad_status in array array['', 'ACTIVE', 'cancelled', ' active ', null] loop
        begin
          update public.tournaments
          set status = bad_status
          where tournament_id = 920001;
          raise exception 'invalid tournament status accepted: %', bad_status;
        exception
          when check_violation or not_null_violation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated malformed tournament states are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      bad_rating double precision;
    begin
      foreach bad_rating in array array[
        'NaN'::double precision,
        'Infinity'::double precision,
        '-Infinity'::double precision,
        null
      ] loop
        begin
          update public.ratings
          set rating = bad_rating
          where game_id = 920001
            and user_id = '00000000-0000-4000-8000-000000000001';
          raise exception 'non-finite rating accepted: %', bad_rating;
        exception
          when check_violation or not_null_violation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated non-finite rating boundaries are rejected'
);

select lives_ok(
  $test$
    do $do$
    declare
      bad_data json;
    begin
      foreach bad_data in array array[
        'null'::json,
        '[]'::json,
        '"text"'::json,
        '1'::json,
        'true'::json,
        null
      ] loop
        begin
          update public.ratings
          set other_data = bad_data
          where game_id = 920001
            and user_id = '00000000-0000-4000-8000-000000000001';
          raise exception 'non-object rating metadata accepted: %', bad_data;
        exception
          when check_violation or not_null_violation then null;
        end;
      end loop;
    end
    $do$
  $test$,
  'generated non-object rating metadata is rejected'
);

select lives_ok(
  $test$
    update public.ratings
    set rating = -1.7976931348623157e308,
        other_data = '{"rd": 350, "nested": {"valid": true}}'
    where game_id = 920001
      and user_id = '00000000-0000-4000-8000-000000000001';

    update public.ratings
    set rating = 1.7976931348623157e308
    where game_id = 920001
      and user_id = '00000000-0000-4000-8000-000000000001'
  $test$,
  'finite float boundaries and object metadata remain valid'
);

select lives_ok(
  $test$
    do $do$
    begin
      begin
        insert into public.ratings (game_id, user_id)
        values (
          999999999,
          '00000000-0000-4000-8000-000000000001'
        );
        raise exception 'rating with missing game accepted';
      exception
        when foreign_key_violation then null;
      end;

      begin
        insert into public.ratings (game_id, user_id)
        values (
          920001,
          'ffffffff-ffff-4fff-8fff-ffffffffffff'
        );
        raise exception 'rating with missing user accepted';
      exception
        when insufficient_privilege then null;
      end;

      begin
        insert into public.tournament_participants (tournament_id, user_id)
        values (
          999999999,
          '00000000-0000-4000-8000-000000000001'
        );
        raise exception 'participant with missing tournament accepted';
      exception
        when insufficient_privilege then null;
      end;
    end
    $do$
  $test$,
  'missing foreign-key targets fail before orphaned rows can be created'
);

select throws_ok(
  $test$
    insert into public.ratings (game_id, user_id)
    values (
      920001,
      '00000000-0000-4000-8000-000000000001'
    )
  $test$,
  '23505',
  null,
  'duplicate ratings are rejected at the composite-key boundary'
);

select throws_ok(
  $test$
    update public.tournaments
    set created_by = '00000000-0000-4000-8000-000000000002'
    where tournament_id = 920001
  $test$,
  '42501',
  null,
  'a creator cannot transfer ownership during a state mutation'
);

select lives_ok(
  $test$
    update public.tournaments
    set status = 'active'
    where tournament_id = 920001;

    update public.tournaments
    set status = 'completed'
    where tournament_id = 920001
  $test$,
  'the creator can perform the supported pending-active-completed state path'
);

reset role;

select * from finish();
rollback;
