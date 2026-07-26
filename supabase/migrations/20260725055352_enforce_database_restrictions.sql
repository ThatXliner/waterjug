-- Make Data API privileges explicit. RLS limits rows, while these grants limit
-- which operations each API role can attempt at all.
revoke all privileges on table public.games from anon, authenticated;
revoke all privileges on table public.profiles from anon, authenticated;
revoke all privileges on table public.ratings from anon, authenticated;
revoke all privileges on table public.tournaments from anon, authenticated;
revoke all privileges on table public.tournament_participants from anon, authenticated;
revoke all privileges on sequence public.games_game_id_seq from anon, authenticated;
revoke all privileges on sequence public.tournaments_tournament_id_seq from anon, authenticated;

grant select on table
  public.games,
  public.profiles,
  public.ratings,
  public.tournaments,
  public.tournament_participants
to anon, authenticated;

grant insert (name, created_by, rating_configuration)
on table public.games
to authenticated;
grant update (rating_configuration, rating_configuration_revision)
on table public.games
to authenticated;
grant usage on sequence public.games_game_id_seq to authenticated;

grant update (display_name, username) on table public.profiles to authenticated;

grant insert, update on table public.ratings to authenticated;

grant insert, update on table public.tournaments to authenticated;
grant usage on sequence public.tournaments_tournament_id_seq to authenticated;

grant insert on table public.tournament_participants to authenticated;

-- Reject values that satisfy the original NOT NULL declarations but are not
-- usable application data.
alter table public.games
  add constraint games_name_not_blank
  check (length(regexp_replace(name, '[[:space:]]', '', 'g')) > 0),
  add constraint games_rating_configuration_exact_shape
  check (
    case
      when jsonb_typeof(rating_configuration) = 'object'
        and jsonb_typeof(rating_configuration->'glicko') = 'object'
        and jsonb_typeof(rating_configuration->'elo') = 'object'
        and jsonb_typeof(rating_configuration->'custom') = 'object'
      then
        (
          rating_configuration
          - 'version'
          - 'system'
          - 'defaultRating'
          - 'periodDays'
          - 'glicko'
          - 'elo'
          - 'custom'
        ) = '{}'::jsonb
        and (
          (rating_configuration->'glicko')
          - 'initialDeviation'
          - 'maxDeviation'
          - 'periodDeviationIncrease'
          - 'scale'
        ) = '{}'::jsonb
        and (
          (rating_configuration->'elo')
          - 'kFactor'
          - 'scale'
        ) = '{}'::jsonb
        and (
          (rating_configuration->'custom')
          - 'formula'
        ) = '{}'::jsonb
      else false
    end
  ),
  add constraint games_rating_configuration_version_exact
  check (rating_configuration->'version' = '1'::jsonb),
  add constraint games_rating_configuration_formula_not_blank
  check (
    length(
      regexp_replace(
        rating_configuration->'custom'->>'formula',
        '[[:space:]]',
        '',
        'g'
      )
    ) > 0
  );

alter table public.tournaments
  add constraint tournaments_name_not_blank
  check (length(regexp_replace(name, '[[:space:]]', '', 'g')) > 0);

alter table public.ratings
  add constraint ratings_rating_finite
  check (
    rating not in (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
  ),
  add constraint ratings_other_data_is_object
  check (json_typeof(other_data) = 'object');

-- Recreate policies with explicit roles and ownership checks. In particular,
-- callers may not create a tournament for another user or add participants to
-- a tournament they did not create.
drop policy if exists "Enable insert for authenticated users only" on public.games;
create policy "Authenticated users can create games"
on public.games
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = created_by
);

drop policy if exists "Enable read access for all users" on public.games;
create policy "Games are publicly readable"
on public.games
for select
to anon, authenticated
using (true);

-- Retain the rating-configuration ownership policy introduced by the
-- configuration migration, while making the identity check explicit and
-- optimized. Column grants above ensure this policy cannot be used to mutate
-- the game identity, owner, name, or creation timestamp.
drop policy if exists "Game owners may update rating configuration" on public.games;
create policy "Game owners may update rating configuration"
on public.games
for update
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = created_by
)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = created_by
);

-- The revision is the compare-and-set token used by the application. Keep the
-- configuration and its token atomic even when a caller bypasses application
-- validation and writes through the Data API directly.
create schema if not exists private;
revoke all privileges on schema private from public, anon, authenticated;

create function private.enforce_game_rating_configuration_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rating_configuration is distinct from old.rating_configuration then
    if new.rating_configuration_revision <> old.rating_configuration_revision + 1 then
      raise check_violation using
        constraint = 'games_rating_configuration_revision_step',
        message = 'rating configuration changes must increment the revision by exactly one';
    end if;
  elsif new.rating_configuration_revision <> old.rating_configuration_revision then
    raise check_violation using
      constraint = 'games_rating_configuration_revision_pair',
      message = 'rating configuration revision cannot change without the configuration';
  end if;

  return new;
end
$$;

revoke all privileges
on function private.enforce_game_rating_configuration_revision()
from public, anon, authenticated;

create trigger enforce_game_rating_configuration_revision
before update of rating_configuration, rating_configuration_revision
on public.games
for each row
execute function private.enforce_game_rating_configuration_revision();

drop policy if exists "Enable read access for all users" on public.profiles;
drop policy if exists "Enable read access for own profile" on public.profiles;
create policy "Profiles are publicly readable"
on public.profiles
for select
to anon, authenticated
using (true);

drop policy if exists "Enable update for own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Enable read access for all users" on public.ratings;
create policy "Ratings are publicly readable"
on public.ratings
for select
to anon, authenticated
using (true);

drop policy if exists "You may only add your own rating" on public.ratings;
create policy "Users can add their own rating"
on public.ratings
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "You may only update your own rating" on public.ratings;
create policy "Users can update their own rating"
on public.ratings
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Enable read access for all users" on public.tournaments;
create policy "Tournaments are publicly readable"
on public.tournaments
for select
to anon, authenticated
using (true);

drop policy if exists "Enable insert for authenticated users" on public.tournaments;
create policy "Users can create their own tournaments"
on public.tournaments
for insert
to authenticated
with check ((select auth.uid()) = created_by);

drop policy if exists "Enable update for creator" on public.tournaments;
create policy "Creators can update their tournaments"
on public.tournaments
for update
to authenticated
using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);

drop policy if exists "Enable read access for all users" on public.tournament_participants;
create policy "Tournament participants are publicly readable"
on public.tournament_participants
for select
to anon, authenticated
using (true);

drop policy if exists "Enable insert for authenticated users" on public.tournament_participants;
create policy "Tournament creators can add participants"
on public.tournament_participants
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.tournaments
    where tournaments.tournament_id = tournament_participants.tournament_id
      and tournaments.created_by = (select auth.uid())
  )
);

-- This function is only an Auth trigger implementation, not a public RPC.
-- Its body already qualifies public.profiles, so it can use an empty search path.
alter function public.handle_new_user() set search_path = '';
revoke all privileges on function public.handle_new_user() from public, anon, authenticated;
