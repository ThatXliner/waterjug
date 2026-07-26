-- Upgrade live rating configuration and state from the original Glicko model
-- to Glicko-2. Confirmed/disputed result snapshots remain immutable audit data;
-- pending snapshots migrate with their game so they can still be reviewed.

ALTER TABLE public.games
  DROP CONSTRAINT games_rating_configuration_shape_check,
  DROP CONSTRAINT games_rating_configuration_exact_shape,
  DROP CONSTRAINT games_rating_configuration_version_exact;

ALTER TABLE public.games DISABLE TRIGGER enforce_game_rating_configuration_revision;

UPDATE public.games
SET rating_configuration =
  jsonb_set(
    jsonb_set(
      rating_configuration,
      '{version}',
      '2'::jsonb
    ),
    '{glicko}',
    jsonb_build_object(
      'initialDeviation', rating_configuration#>'{glicko,initialDeviation}',
      'maxDeviation', rating_configuration#>'{glicko,maxDeviation}',
      'initialVolatility', 0.06,
      'tau', 0.5
    )
  );

ALTER TABLE public.games ENABLE TRIGGER enforce_game_rating_configuration_revision;

UPDATE public.ratings
SET other_data = (
  other_data::jsonb || jsonb_build_object(
    'volatility',
    coalesce((other_data::jsonb)->'volatility', '0.06'::jsonb)
  )
)::json
WHERE type = 'glicko';

UPDATE public.game_results AS result
SET
  rating_configuration_snapshot = game.rating_configuration,
  winner_other_data_snapshot =
    CASE WHEN result.winner_type_snapshot = 'glicko'
      THEN result.winner_other_data_snapshot
        || jsonb_build_object(
          'volatility',
          coalesce(result.winner_other_data_snapshot->'volatility', '0.06'::jsonb)
        )
      ELSE result.winner_other_data_snapshot
    END,
  loser_other_data_snapshot =
    CASE WHEN result.loser_type_snapshot = 'glicko'
      THEN result.loser_other_data_snapshot
        || jsonb_build_object(
          'volatility',
          coalesce(result.loser_other_data_snapshot->'volatility', '0.06'::jsonb)
        )
      ELSE result.loser_other_data_snapshot
    END
FROM public.games AS game
WHERE result.game_id = game.game_id
  AND result.status = 'pending';

ALTER TABLE public.games
  ALTER COLUMN rating_configuration SET DEFAULT '{
    "version": 2,
    "system": "glicko",
    "defaultRating": 1200,
    "periodDays": 1,
    "glicko": {
      "initialDeviation": 350,
      "maxDeviation": 350,
      "initialVolatility": 0.06,
      "tau": 0.5
    },
    "elo": {
      "kFactor": 32,
      "scale": 400
    },
    "custom": {
      "formula": "rating + 32 * (score - expected)"
    }
  }'::jsonb;

ALTER TABLE public.games
  ADD CONSTRAINT games_rating_configuration_shape_check CHECK (
    jsonb_typeof(rating_configuration) = 'object'
    AND rating_configuration ?& ARRAY[
      'version', 'system', 'defaultRating', 'periodDays', 'glicko', 'elo', 'custom'
    ]
    AND jsonb_typeof(rating_configuration->'version') = 'number'
    AND (rating_configuration->>'version')::integer = 2
    AND jsonb_typeof(rating_configuration->'system') = 'string'
    AND rating_configuration->>'system' IN ('glicko', 'elo', 'custom')
    AND jsonb_typeof(rating_configuration->'defaultRating') = 'number'
    AND (rating_configuration->>'defaultRating')::double precision BETWEEN 0 AND 1000000
    AND jsonb_typeof(rating_configuration->'periodDays') = 'number'
    AND (rating_configuration->>'periodDays')::double precision BETWEEN (1.0 / 24.0) AND 3650
    AND jsonb_typeof(rating_configuration->'glicko') = 'object'
    AND (rating_configuration->'glicko') ?& ARRAY[
      'initialDeviation', 'maxDeviation', 'initialVolatility', 'tau'
    ]
    AND jsonb_typeof(rating_configuration#>'{glicko,initialDeviation}') = 'number'
    AND (rating_configuration#>>'{glicko,initialDeviation}')::double precision BETWEEN 1 AND 1000
    AND jsonb_typeof(rating_configuration#>'{glicko,maxDeviation}') = 'number'
    AND (rating_configuration#>>'{glicko,maxDeviation}')::double precision BETWEEN 1 AND 1000
    AND (rating_configuration#>>'{glicko,initialDeviation}')::double precision
      <= (rating_configuration#>>'{glicko,maxDeviation}')::double precision
    AND jsonb_typeof(rating_configuration#>'{glicko,initialVolatility}') = 'number'
    AND (rating_configuration#>>'{glicko,initialVolatility}')::double precision
      BETWEEN 0.000001 AND 0.2
    AND jsonb_typeof(rating_configuration#>'{glicko,tau}') = 'number'
    AND (rating_configuration#>>'{glicko,tau}')::double precision BETWEEN 0.3 AND 1.2
    AND jsonb_typeof(rating_configuration->'elo') = 'object'
    AND (rating_configuration->'elo') ?& ARRAY['kFactor', 'scale']
    AND jsonb_typeof(rating_configuration#>'{elo,kFactor}') = 'number'
    AND (rating_configuration#>>'{elo,kFactor}')::double precision BETWEEN 0.01 AND 1000
    AND jsonb_typeof(rating_configuration#>'{elo,scale}') = 'number'
    AND (rating_configuration#>>'{elo,scale}')::double precision BETWEEN 1 AND 10000
    AND jsonb_typeof(rating_configuration->'custom') = 'object'
    AND (rating_configuration->'custom') ? 'formula'
    AND jsonb_typeof(rating_configuration#>'{custom,formula}') = 'string'
    AND char_length(rating_configuration#>>'{custom,formula}') BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT games_rating_configuration_exact_shape CHECK (
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
          - 'initialVolatility' - 'tau' = '{}'::jsonb
        AND (rating_configuration->'elo') - 'kFactor' - 'scale' = '{}'::jsonb
        AND (rating_configuration->'custom') - 'formula' = '{}'::jsonb
      ELSE false
    END
  ),
  ADD CONSTRAINT games_rating_configuration_version_exact
    CHECK (rating_configuration->'version' = '2'::jsonb);

CREATE OR REPLACE FUNCTION public.ensure_game_rating(p_game_id bigint)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  rating_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT games.rating_configuration
  INTO rating_snapshot
  FROM public.games
  WHERE games.game_id = p_game_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Game not found or you do not have permission to join it'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ratings (game_id, user_id, rating, type, other_data)
  VALUES (
    p_game_id,
    auth.uid(),
    (rating_snapshot->>'defaultRating')::double precision,
    rating_snapshot->>'system',
    jsonb_strip_nulls(jsonb_build_object(
      'deviation',
      CASE WHEN rating_snapshot->>'system' = 'glicko'
        THEN (rating_snapshot#>>'{glicko,initialDeviation}')::double precision
      END,
      'volatility',
      CASE WHEN rating_snapshot->>'system' = 'glicko'
        THEN (rating_snapshot#>>'{glicko,initialVolatility}')::double precision
      END,
      'lastRatedAt',
      CURRENT_TIMESTAMP
    ))::json
  )
  ON CONFLICT (user_id, game_id) DO NOTHING;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.ensure_game_rating(bigint)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_game_rating(bigint) TO authenticated;

COMMENT ON COLUMN public.games.rating_configuration IS
  'Versioned rating settings. Version 2 uses Glicko-2 volatility and tau.';
