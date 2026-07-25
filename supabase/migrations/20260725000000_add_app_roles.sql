CREATE TYPE "public"."app_role" AS ENUM ('player', 'admin');

ALTER TABLE "public"."profiles"
    ADD COLUMN "role" "public"."app_role" NOT NULL DEFAULT 'player';

COMMENT ON COLUMN "public"."profiles"."role" IS
    'Application role. Only service-role operations may change this value.';

CREATE OR REPLACE FUNCTION "public"."prevent_profile_role_change"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role
       AND current_user IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'profile roles may only be changed by the service role'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "prevent_profile_role_change"
    BEFORE UPDATE OF "role" ON "public"."profiles"
    FOR EACH ROW EXECUTE FUNCTION "public"."prevent_profile_role_change"();

DROP POLICY "Enable insert for authenticated users only" ON "public"."games";

CREATE POLICY "Admins may create games"
    ON "public"."games"
    FOR INSERT
    TO "authenticated"
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM "public"."profiles"
            WHERE "profiles"."user_id" = auth.uid()
              AND "profiles"."role" = 'admin'
        )
    );

DROP POLICY "Enable insert for authenticated users" ON public.tournaments;
CREATE POLICY "Users may create their own tournaments"
    ON public.tournaments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) IS NOT NULL
        AND (SELECT auth.uid()) = created_by
    );

DROP POLICY "Enable insert for authenticated users" ON public.tournament_participants;
CREATE POLICY "Tournament creators may add participants"
    ON public.tournament_participants
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.tournaments
            WHERE tournaments.tournament_id = tournament_participants.tournament_id
              AND tournaments.created_by = (SELECT auth.uid())
        )
    );

GRANT SELECT ON TABLE
    public.games,
    public.profiles,
    public.ratings,
    public.tournaments,
    public.tournament_participants
TO anon, authenticated;

GRANT INSERT ON TABLE
    public.games,
    public.ratings,
    public.tournaments,
    public.tournament_participants
TO authenticated;

GRANT UPDATE ON TABLE
    public.profiles,
    public.ratings,
    public.tournaments
TO authenticated;

GRANT ALL ON TABLE
    public.games,
    public.profiles,
    public.ratings,
    public.tournaments,
    public.tournament_participants
TO service_role;

GRANT USAGE, SELECT ON SEQUENCE
    public.games_game_id_seq,
    public.tournaments_tournament_id_seq
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION "public"."apply_rating_result"(
    "p_game_id" bigint,
    "p_expected_configuration_revision" bigint,
    "p_loser_id" uuid,
    "p_winner_id" uuid,
    "p_expected_loser_rating" double precision,
    "p_expected_loser_type" text,
    "p_expected_loser_other_data" jsonb,
    "p_expected_winner_rating" double precision,
    "p_expected_winner_type" text,
    "p_expected_winner_other_data" jsonb,
    "p_new_loser_rating" double precision,
    "p_new_loser_other_data" jsonb,
    "p_new_winner_rating" double precision,
    "p_new_winner_other_data" jsonb,
    "p_new_type" text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    loser public.ratings%ROWTYPE;
    winner public.ratings%ROWTYPE;
    current_configuration_revision bigint;
BEGIN
    IF p_loser_id = p_winner_id THEN
        RAISE EXCEPTION 'winner and loser must be different users'
            USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(p_game_id);

    SELECT rating_configuration_revision
    INTO current_configuration_revision
    FROM public.games
    WHERE game_id = p_game_id
    FOR SHARE;

    IF current_configuration_revision IS NULL THEN
        RAISE EXCEPTION 'game does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF current_configuration_revision IS DISTINCT FROM p_expected_configuration_revision THEN
        RETURN false;
    END IF;

    SELECT * INTO loser
    FROM public.ratings
    WHERE game_id = p_game_id AND user_id = p_loser_id
    FOR UPDATE;

    SELECT * INTO winner
    FROM public.ratings
    WHERE game_id = p_game_id AND user_id = p_winner_id
    FOR UPDATE;

    IF loser.user_id IS NULL OR winner.user_id IS NULL THEN
        RAISE EXCEPTION 'both users must have ratings for the game'
            USING ERRCODE = '23503';
    END IF;

    IF loser.rating IS DISTINCT FROM p_expected_loser_rating
       OR loser.type IS DISTINCT FROM p_expected_loser_type
       OR loser.other_data IS DISTINCT FROM p_expected_loser_other_data
       OR winner.rating IS DISTINCT FROM p_expected_winner_rating
       OR winner.type IS DISTINCT FROM p_expected_winner_type
       OR winner.other_data IS DISTINCT FROM p_expected_winner_other_data THEN
        RETURN false;
    END IF;

    UPDATE public.ratings
    SET rating = p_new_loser_rating,
        type = p_new_type,
        other_data = p_new_loser_other_data
    WHERE game_id = p_game_id AND user_id = p_loser_id;

    UPDATE public.ratings
    SET rating = p_new_winner_rating,
        type = p_new_type,
        other_data = p_new_winner_other_data
    WHERE game_id = p_game_id AND user_id = p_winner_id;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION "public"."apply_rating_result"(
    bigint, bigint, uuid, uuid,
    double precision, text, jsonb,
    double precision, text, jsonb,
    double precision, jsonb,
    double precision, jsonb, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "public"."apply_rating_result"(
    bigint, bigint, uuid, uuid,
    double precision, text, jsonb,
    double precision, text, jsonb,
    double precision, jsonb,
    double precision, jsonb, text
) TO service_role;
