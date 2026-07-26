-- Final least-privilege audit for the complete application schema.
-- Grants limit which columns the Data API can target; RLS limits rows.

REVOKE ALL PRIVILEGES ON TABLE
  public.games,
  public.profiles,
  public.ratings,
  public.tournaments,
  public.tournament_participants,
  public.game_invites,
  public.game_results
FROM anon, authenticated;

REVOKE ALL PRIVILEGES ON SEQUENCE
  public.games_game_id_seq,
  public.tournaments_tournament_id_seq,
  public.game_results_id_seq
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.games,
  public.profiles,
  public.ratings,
  public.tournaments,
  public.tournament_participants
TO anon, authenticated;

-- Anonymous access to game_invites is required only so the games RLS policy
-- can evaluate its invite lookup. No anon policy exposes invitation rows.
GRANT SELECT ON TABLE public.game_invites TO anon;
GRANT SELECT ON TABLE public.game_invites, public.game_results TO authenticated;

GRANT INSERT (name, created_by, invite_only, rating_configuration)
  ON TABLE public.games TO authenticated;
GRANT UPDATE (rating_configuration, rating_configuration_revision)
  ON TABLE public.games TO authenticated;
GRANT USAGE ON SEQUENCE public.games_game_id_seq TO authenticated;

GRANT UPDATE (display_name, username)
  ON TABLE public.profiles TO authenticated;

-- Ratings are initialized through ensure_game_rating(). Result changes are
-- service-only state transitions; clients cannot rewrite their own score.
GRANT INSERT (game_id, user_id, rating, type, other_data)
  ON TABLE public.ratings TO authenticated;

GRANT INSERT (game_id, name, type, status, created_by)
  ON TABLE public.tournaments TO authenticated;
GRANT UPDATE (name, type, status)
  ON TABLE public.tournaments TO authenticated;
GRANT USAGE ON SEQUENCE public.tournaments_tournament_id_seq TO authenticated;

GRANT INSERT (tournament_id, user_id)
  ON TABLE public.tournament_participants TO authenticated;

GRANT INSERT (game_id, invited_email, invited_by)
  ON TABLE public.game_invites TO authenticated;
GRANT DELETE ON TABLE public.game_invites TO authenticated;

GRANT INSERT (game_id, reporter_id, submission_id, winner_id, loser_id)
  ON TABLE public.game_results TO authenticated;
GRANT USAGE ON SEQUENCE public.game_results_id_seq TO authenticated;

-- Reject syntactically valid but unusable values at every write boundary.
ALTER TABLE public.games
  ADD CONSTRAINT games_name_not_blank
  CHECK (length(regexp_replace(name, '[[:space:]]', '', 'g')) > 0),
  ADD CONSTRAINT games_rating_configuration_exact_shape
  CHECK (
    CASE
      WHEN jsonb_typeof(rating_configuration) = 'object'
        AND jsonb_typeof(rating_configuration->'glicko') = 'object'
        AND jsonb_typeof(rating_configuration->'elo') = 'object'
        AND jsonb_typeof(rating_configuration->'custom') = 'object'
      THEN
        rating_configuration
          - 'version' - 'system' - 'defaultRating' - 'periodDays'
          - 'glicko' - 'elo' - 'custom' = '{}'::jsonb
        AND (rating_configuration->'glicko')
          - 'initialDeviation' - 'maxDeviation'
          - 'periodDeviationIncrease' - 'scale' = '{}'::jsonb
        AND (rating_configuration->'elo') - 'kFactor' - 'scale' = '{}'::jsonb
        AND (rating_configuration->'custom') - 'formula' = '{}'::jsonb
      ELSE false
    END
  ),
  ADD CONSTRAINT games_rating_configuration_version_exact
  CHECK (rating_configuration->'version' = '1'::jsonb),
  ADD CONSTRAINT games_rating_configuration_formula_not_blank
  CHECK (
    length(regexp_replace(
      rating_configuration->'custom'->>'formula',
      '[[:space:]]',
      '',
      'g'
    )) > 0
  );

ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_name_not_blank
  CHECK (length(regexp_replace(name, '[[:space:]]', '', 'g')) > 0);

ALTER TABLE public.ratings
  ADD CONSTRAINT ratings_rating_finite
  CHECK (rating NOT IN (
    'NaN'::double precision,
    'Infinity'::double precision,
    '-Infinity'::double precision
  )),
  ADD CONSTRAINT ratings_type_supported
  CHECK (type IN ('glicko', 'elo', 'custom')),
  ADD CONSTRAINT ratings_other_data_is_object
  CHECK (json_typeof(other_data) = 'object');

ALTER TABLE public.game_results
  ADD CONSTRAINT game_results_snapshot_ratings_finite
  CHECK (
    winner_rating_snapshot NOT IN (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
    AND loser_rating_snapshot NOT IN (
      'NaN'::double precision,
      'Infinity'::double precision,
      '-Infinity'::double precision
    )
  ),
  ADD CONSTRAINT game_results_snapshot_types_supported
  CHECK (
    winner_type_snapshot IN ('glicko', 'elo', 'custom')
    AND loser_type_snapshot IN ('glicko', 'elo', 'custom')
  ),
  ADD CONSTRAINT game_results_snapshot_json_objects
  CHECK (
    jsonb_typeof(rating_configuration_snapshot) = 'object'
    AND jsonb_typeof(winner_other_data_snapshot) = 'object'
    AND jsonb_typeof(loser_other_data_snapshot) = 'object'
  );

-- Foreign-key and policy predicates need leading indexes.
CREATE INDEX IF NOT EXISTS games_created_by_idx
  ON public.games (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ratings_game_id_idx ON public.ratings (game_id);
CREATE INDEX IF NOT EXISTS tournaments_game_id_idx ON public.tournaments (game_id);
CREATE INDEX IF NOT EXISTS tournaments_created_by_idx ON public.tournaments (created_by);
CREATE INDEX IF NOT EXISTS tournament_participants_user_id_idx
  ON public.tournament_participants (user_id);
CREATE INDEX IF NOT EXISTS game_invites_invited_by_idx ON public.game_invites (invited_by);
CREATE INDEX IF NOT EXISTS game_results_reviewed_by_idx
  ON public.game_results (reviewed_by) WHERE reviewed_by IS NOT NULL;

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins may create games" ON public.games;
DROP POLICY IF EXISTS "Game owners may update rating configuration" ON public.games;
DROP POLICY IF EXISTS "Users can view accessible games" ON public.games;

CREATE POLICY "Admins may create games"
  ON public.games FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = created_by
    AND EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.user_id = (SELECT auth.uid())
        AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Game owners may update rating configuration"
  ON public.games FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = created_by)
  WITH CHECK ((SELECT auth.uid()) = created_by);

CREATE POLICY "Users can view accessible games"
  ON public.games FOR SELECT TO anon, authenticated
  USING (
    NOT invite_only
    OR (SELECT auth.uid()) = created_by
    OR EXISTS (
      SELECT 1
      FROM public.game_invites
      WHERE game_invites.game_id = games.game_id
        AND game_invites.invited_email =
          lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
    )
  );

DROP POLICY IF EXISTS "Public profiles are viewable" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "Public profiles are viewable"
  ON public.profiles FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view ratings for accessible games" ON public.ratings;
DROP POLICY IF EXISTS "Users can join accessible games" ON public.ratings;
DROP POLICY IF EXISTS "Users can update their rating in accessible games" ON public.ratings;

CREATE POLICY "Users can view ratings for accessible games"
  ON public.ratings FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = ratings.game_id
    )
  );

CREATE POLICY "Users can join accessible games"
  ON public.ratings FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = ratings.game_id
    )
  );

DROP POLICY IF EXISTS "Users can view tournaments for accessible games"
  ON public.tournaments;
DROP POLICY IF EXISTS "Users can create tournaments for accessible games"
  ON public.tournaments;
DROP POLICY IF EXISTS "Creators can update accessible tournaments"
  ON public.tournaments;

CREATE POLICY "Users can view tournaments for accessible games"
  ON public.tournaments FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = tournaments.game_id
    )
  );

CREATE POLICY "Users can create tournaments for accessible games"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = created_by
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = tournaments.game_id
    )
  );

CREATE POLICY "Creators can update accessible tournaments"
  ON public.tournaments FOR UPDATE TO authenticated
  USING (
    (SELECT auth.uid()) = created_by
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = tournaments.game_id
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = created_by
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = tournaments.game_id
    )
  );

DROP POLICY IF EXISTS "Users can view participants for accessible tournaments"
  ON public.tournament_participants;
DROP POLICY IF EXISTS "Users can add participants to accessible tournaments"
  ON public.tournament_participants;

CREATE POLICY "Users can view participants for accessible tournaments"
  ON public.tournament_participants FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.tournaments
      WHERE tournaments.tournament_id = tournament_participants.tournament_id
    )
  );

CREATE POLICY "Users can add participants to accessible tournaments"
  ON public.tournament_participants FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tournaments
      WHERE tournaments.tournament_id = tournament_participants.tournament_id
        AND tournaments.created_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Creators can add game invites" ON public.game_invites;
DROP POLICY IF EXISTS "Creators and invitees can view game invites" ON public.game_invites;
DROP POLICY IF EXISTS "Creators can remove game invites" ON public.game_invites;

CREATE POLICY "Creators can add game invites"
  ON public.game_invites FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = (SELECT auth.uid())
  );
-- The composite (game_id, invited_by) foreign key independently proves that
-- the caller owns the game without a recursive games-policy lookup.

CREATE POLICY "Creators and invitees can view game invites"
  ON public.game_invites FOR SELECT TO authenticated
  USING (
    invited_by = (SELECT auth.uid())
    OR invited_email = lower(coalesce((SELECT auth.jwt()) ->> 'email', ''))
  );

CREATE POLICY "Creators can remove game invites"
  ON public.game_invites FOR DELETE TO authenticated
  USING (invited_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Current participants can view accessible game results"
  ON public.game_results;
DROP POLICY IF EXISTS "Current participants can report accessible game results"
  ON public.game_results;

CREATE POLICY "Current participants can view accessible game results"
  ON public.game_results FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) IN (winner_id, loser_id)
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = game_results.game_id
    )
  );

CREATE POLICY "Current participants can report accessible game results"
  ON public.game_results FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND reporter_id IN (winner_id, loser_id)
    AND EXISTS (
      SELECT 1 FROM public.games
      WHERE games.game_id = game_results.game_id
    )
  );

-- Keep configuration and its compare-and-set revision inseparable even for
-- direct Data API writes.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL PRIVILEGES ON SCHEMA private FROM public, anon, authenticated;

CREATE FUNCTION private.enforce_game_rating_configuration_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.rating_configuration IS DISTINCT FROM OLD.rating_configuration THEN
    IF NEW.rating_configuration_revision <> OLD.rating_configuration_revision + 1 THEN
      RAISE check_violation USING
        CONSTRAINT = 'games_rating_configuration_revision_step',
        MESSAGE = 'rating configuration changes must increment the revision by exactly one';
    END IF;
  ELSIF NEW.rating_configuration_revision <> OLD.rating_configuration_revision THEN
    RAISE check_violation USING
      CONSTRAINT = 'games_rating_configuration_revision_pair',
      MESSAGE = 'rating configuration revision cannot change without the configuration';
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION private.enforce_game_rating_configuration_revision()
  FROM public, anon, authenticated;

CREATE TRIGGER enforce_game_rating_configuration_revision
  BEFORE UPDATE OF rating_configuration, rating_configuration_revision
  ON public.games
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_game_rating_configuration_revision();

-- Result submission takes the same per-game advisory lock as review, so rating
-- snapshots cannot race supported state transitions. Avoid SELECT FOR UPDATE
-- here: it would require granting clients table-level UPDATE and thereby let
-- them bypass peer confirmation.
CREATE OR REPLACE FUNCTION public.prepare_game_result()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  current_user_id uuid := auth.uid();
  current_revision bigint;
  current_configuration jsonb;
  winner_row public.ratings%ROWTYPE;
  loser_row public.ratings%ROWTYPE;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NEW.winner_id = NEW.loser_id THEN
    RAISE EXCEPTION 'Winner and loser must be different players' USING ERRCODE = '22023';
  END IF;
  IF current_user_id NOT IN (NEW.winner_id, NEW.loser_id) THEN
    RAISE EXCEPTION 'Only a participant can report this result' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(NEW.game_id);

  SELECT games.rating_configuration_revision, games.rating_configuration::jsonb
  INTO current_revision, current_configuration
  FROM public.games
  WHERE games.game_id = NEW.game_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found or no longer accessible' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO winner_row
  FROM public.ratings
  WHERE game_id = NEW.game_id AND user_id = NEW.winner_id;

  SELECT * INTO loser_row
  FROM public.ratings
  WHERE game_id = NEW.game_id AND user_id = NEW.loser_id;

  IF winner_row.user_id IS NULL OR loser_row.user_id IS NULL THEN
    RAISE EXCEPTION 'Both players must have a rating in this game' USING ERRCODE = '23503';
  END IF;

  NEW.reporter_id := current_user_id;
  NEW.status := 'pending';
  NEW.configuration_revision := current_revision;
  NEW.rating_configuration_snapshot := current_configuration;
  NEW.winner_rating_snapshot := winner_row.rating;
  NEW.winner_type_snapshot := winner_row.type;
  NEW.winner_other_data_snapshot := winner_row.other_data::jsonb;
  NEW.loser_rating_snapshot := loser_row.rating;
  NEW.loser_type_snapshot := loser_row.type;
  NEW.loser_other_data_snapshot := loser_row.other_data::jsonb;
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  NEW.created_at := coalesce(NEW.created_at, now());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Public-schema functions default to PUBLIC EXECUTE, so every RPC and trigger
-- function is closed explicitly and only intended callers are restored.
ALTER FUNCTION public.handle_new_user() SET search_path = '';
ALTER FUNCTION public.ensure_game_rating(bigint) SET search_path = '';

REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user()
  FROM public, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.prevent_profile_role_change()
  FROM public, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.prepare_game_result()
  FROM public, anon, authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.ensure_game_rating(bigint)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_game_rating(bigint) TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_game(text, boolean, text[], jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_game(text, boolean, text[], jsonb)
  TO authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.apply_rating_result(
  bigint, bigint, uuid, uuid,
  double precision, text, jsonb,
  double precision, text, jsonb,
  double precision, jsonb,
  double precision, jsonb, text
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rating_result(
  bigint, bigint, uuid, uuid,
  double precision, text, jsonb,
  double precision, text, jsonb,
  double precision, jsonb,
  double precision, jsonb, text
) TO service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.review_game_result(
  bigint, uuid, text, bigint,
  double precision, text, jsonb,
  double precision, text, jsonb
) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_game_result(
  bigint, uuid, text, bigint,
  double precision, text, jsonb,
  double precision, text, jsonb
) TO service_role;
