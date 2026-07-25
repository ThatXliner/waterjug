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

grant insert on table public.games to authenticated;
grant usage on sequence public.games_game_id_seq to authenticated;

grant update (display_name) on table public.profiles to authenticated;

grant insert, update on table public.ratings to authenticated;

grant insert, update on table public.tournaments to authenticated;
grant usage on sequence public.tournaments_tournament_id_seq to authenticated;

grant insert on table public.tournament_participants to authenticated;

-- Recreate policies with explicit roles and ownership checks. In particular,
-- callers may not create a tournament for another user or add participants to
-- a tournament they did not create.
drop policy if exists "Enable insert for authenticated users only" on public.games;
create policy "Authenticated users can create games"
on public.games
for insert
to authenticated
with check ((select auth.uid()) is not null);

drop policy if exists "Enable read access for all users" on public.games;
create policy "Games are publicly readable"
on public.games
for select
to anon, authenticated
using (true);

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
