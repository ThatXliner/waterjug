-- Make the authenticated grants used by the existing RLS policies explicit so a clean
-- migration replay has the same access model as the hosted project.
GRANT SELECT ON TABLE "public"."games" TO anon, authenticated;
GRANT INSERT ON TABLE "public"."games" TO authenticated;
GRANT UPDATE ("rating_configuration", "rating_configuration_revision")
    ON TABLE "public"."games" TO authenticated;
GRANT SELECT ON TABLE "public"."ratings" TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE "public"."ratings" TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE "public"."games_game_id_seq" TO authenticated;
GRANT ALL ON TABLE "public"."games", "public"."ratings" TO service_role;
GRANT ALL ON SEQUENCE "public"."games_game_id_seq" TO service_role;

CREATE OR REPLACE FUNCTION "public"."ensure_game_rating"("p_game_id" bigint)
RETURNS void
LANGUAGE sql
VOLATILE
SET "search_path" TO 'public'
AS $$
    INSERT INTO public.ratings (game_id, user_id, rating, type, other_data)
    SELECT
        games.game_id,
        auth.uid(),
        (games.rating_configuration->>'defaultRating')::double precision,
        games.rating_configuration->>'system',
        jsonb_strip_nulls(jsonb_build_object(
            'deviation',
            CASE
                WHEN games.rating_configuration->>'system' = 'glicko'
                THEN (games.rating_configuration#>>'{glicko,initialDeviation}')::double precision
            END,
            'lastRatedAt',
            CURRENT_TIMESTAMP
        ))::json
    FROM public.games
    WHERE games.game_id = p_game_id
      AND auth.uid() IS NOT NULL
    ON CONFLICT (user_id, game_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION "public"."ensure_game_rating"(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."ensure_game_rating"(bigint) TO authenticated;

COMMENT ON FUNCTION "public"."ensure_game_rating"(bigint) IS
    'Idempotently snapshots the current rating configuration for a new player without mutating an existing rating.';
