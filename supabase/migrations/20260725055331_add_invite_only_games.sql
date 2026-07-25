alter table public.games
	add column invite_only boolean not null default false;

alter table public.games
	add constraint games_game_id_created_by_key unique (game_id, created_by);

create table public.game_invites (
	game_id bigint not null references public.games (game_id) on delete cascade,
	invited_email text not null,
	invited_by uuid not null references auth.users (id) on delete cascade,
	created_at timestamp with time zone not null default now(),
	primary key (game_id, invited_email),
	constraint game_invites_game_creator_fkey
		foreign key (game_id, invited_by)
		references public.games (game_id, created_by)
		on delete cascade,
	constraint game_invites_normalized_email
		check (
			invited_email = lower(btrim(invited_email))
			and invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
		)
);

alter table public.game_invites enable row level security;

grant select on table public.games to anon;
grant select, insert on table public.games to authenticated;
grant all on table public.games to service_role;
grant usage, select on sequence public.games_game_id_seq to authenticated;
grant all on sequence public.games_game_id_seq to service_role;
grant select on table public.game_invites to anon;
grant select, insert, delete on table public.game_invites to authenticated;
grant all on table public.game_invites to service_role;
grant select on table public.ratings to anon;
grant select, insert, update on table public.ratings to authenticated;
grant all on table public.ratings to service_role;
grant select on table public.tournaments to anon;
grant select, insert, update on table public.tournaments to authenticated;
grant all on table public.tournaments to service_role;
grant usage, select on sequence public.tournaments_tournament_id_seq to authenticated;
grant all on sequence public.tournaments_tournament_id_seq to service_role;
grant select on table public.tournament_participants to anon;
grant select, insert on table public.tournament_participants to authenticated;
grant all on table public.tournament_participants to service_role;

drop policy "Enable insert for authenticated users only" on public.games;
drop policy "Enable read access for all users" on public.games;
drop policy "Enable read access for all users" on public.ratings;
drop policy "You may only add your own rating" on public.ratings;
drop policy "You may only update your own rating" on public.ratings;
drop policy "Enable read access for all users" on public.tournaments;
drop policy "Enable insert for authenticated users" on public.tournaments;
drop policy "Enable update for creator" on public.tournaments;
drop policy "Enable read access for all users" on public.tournament_participants;
drop policy "Enable insert for authenticated users" on public.tournament_participants;

create policy "Authenticated users can create owned games"
	on public.games for insert
	to authenticated
	with check ((select auth.uid()) = created_by);

create policy "Users can view accessible games"
	on public.games for select
	using (
		not invite_only
		or (select auth.uid()) = created_by
		or exists (
			select 1
			from public.game_invites
			where game_invites.game_id = games.game_id
				and game_invites.invited_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
		)
	);

create policy "Creators can add game invites"
	on public.game_invites for insert
	to authenticated
	with check (
		(select auth.uid()) = invited_by
	);

create policy "Creators and invitees can view game invites"
	on public.game_invites for select
	to authenticated
	using (
		(select auth.uid()) = invited_by
		or invited_email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
	);

create policy "Creators can remove game invites"
	on public.game_invites for delete
	to authenticated
	using ((select auth.uid()) = invited_by);

create policy "Users can view ratings for accessible games"
	on public.ratings for select
	using (
		exists (
			select 1
			from public.games
			where games.game_id = ratings.game_id
		)
	);

create policy "Users can join accessible games"
	on public.ratings for insert
	to authenticated
	with check (
		(select auth.uid()) = user_id
		and exists (
			select 1
			from public.games
			where games.game_id = ratings.game_id
		)
	);

create policy "Users can update their rating in accessible games"
	on public.ratings for update
	to authenticated
	using (
		(select auth.uid()) = user_id
		and exists (
			select 1
			from public.games
			where games.game_id = ratings.game_id
		)
	)
	with check (
		(select auth.uid()) = user_id
		and exists (
			select 1
			from public.games
			where games.game_id = ratings.game_id
		)
	);

create policy "Users can view tournaments for accessible games"
	on public.tournaments for select
	using (
		exists (
			select 1
			from public.games
			where games.game_id = tournaments.game_id
		)
	);

create policy "Users can create tournaments for accessible games"
	on public.tournaments for insert
	to authenticated
	with check (
		(select auth.uid()) = created_by
		and exists (
			select 1
			from public.games
			where games.game_id = tournaments.game_id
		)
	);

create policy "Creators can update accessible tournaments"
	on public.tournaments for update
	to authenticated
	using (
		(select auth.uid()) = created_by
		and exists (
			select 1
			from public.games
			where games.game_id = tournaments.game_id
		)
	)
	with check (
		(select auth.uid()) = created_by
		and exists (
			select 1
			from public.games
			where games.game_id = tournaments.game_id
		)
	);

create policy "Users can view participants for accessible tournaments"
	on public.tournament_participants for select
	using (
		exists (
			select 1
			from public.tournaments
			where tournaments.tournament_id = tournament_participants.tournament_id
		)
	);

create policy "Users can add participants to accessible tournaments"
	on public.tournament_participants for insert
	to authenticated
	with check (
		exists (
			select 1
			from public.tournaments
			where tournaments.tournament_id = tournament_participants.tournament_id
		)
	);

create or replace function public.create_game(
	game_name text,
	is_invite_only boolean default false,
	invited_emails text[] default '{}'::text[],
	game_rating_configuration jsonb default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
	new_game_id bigint;
	normalized_game_name text;
	normalized_emails text[];
begin
	if auth.uid() is null then
		raise exception 'Authentication required' using errcode = '42501';
	end if;

	normalized_game_name := regexp_replace(
		coalesce(game_name, ''),
		'^[[:space:]]+|[[:space:]]+$',
		'',
		'g'
	);

	if normalized_game_name = '' then
		raise exception 'Game name is required' using errcode = '22023';
	end if;

	select coalesce(array_agg(distinct lower(btrim(email))), '{}'::text[])
	into normalized_emails
	from unnest(coalesce(invited_emails, '{}'::text[])) as email
	where nullif(btrim(email), '') is not null;

	if is_invite_only and cardinality(normalized_emails) = 0 then
		raise exception 'Invite-only games require at least one invited email'
			using errcode = '22023';
	end if;

	if exists (
		select 1
		from unnest(normalized_emails) as email
		where email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
	) then
		raise exception 'One or more invitation email addresses are invalid'
			using errcode = '22023';
	end if;

	if game_rating_configuration is null then
		insert into public.games (name, created_by, invite_only)
		values (normalized_game_name, auth.uid(), is_invite_only)
		returning game_id into new_game_id;
	else
		insert into public.games (name, created_by, invite_only, rating_configuration)
		values (normalized_game_name, auth.uid(), is_invite_only, game_rating_configuration)
		returning game_id into new_game_id;
	end if;

	if is_invite_only then
		insert into public.game_invites (game_id, invited_email, invited_by)
		select new_game_id, email, auth.uid()
		from unnest(normalized_emails) as email;
	end if;

	return new_game_id;
end;
$$;

revoke all on function public.create_game(text, boolean, text[], jsonb) from public;
revoke all on function public.create_game(text, boolean, text[], jsonb) from anon;
grant execute on function public.create_game(text, boolean, text[], jsonb) to authenticated;
