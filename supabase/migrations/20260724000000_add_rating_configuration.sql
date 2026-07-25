ALTER TABLE "public"."games"
    ADD COLUMN "created_by" uuid REFERENCES "auth"."users"("id") ON DELETE SET NULL,
    ADD COLUMN "rating_configuration" jsonb NOT NULL DEFAULT '{
      "version": 1,
      "system": "glicko",
      "defaultRating": 1200,
      "periodDays": 1,
      "glicko": {
        "initialDeviation": 350,
        "maxDeviation": 350,
        "periodDeviationIncrease": 63.2,
        "scale": 400
      },
      "elo": {
        "kFactor": 32,
        "scale": 400
      },
      "custom": {
        "formula": "rating + 32 * (score - expected)"
      }
    }'::jsonb;

-- Preserve editability for existing games by assigning the earliest participant
-- as their configuration owner. Empty legacy games remain ownerless.
UPDATE "public"."games" AS "game"
SET "created_by" = (
    SELECT "rating"."user_id"
    FROM "public"."ratings" AS "rating"
    WHERE "rating"."game_id" = "game"."game_id"
    ORDER BY "rating"."created_at", "rating"."user_id"
    LIMIT 1
)
WHERE "game"."created_by" IS NULL;

ALTER TABLE "public"."games"
    ADD CONSTRAINT "games_rating_configuration_shape_check" CHECK (
        jsonb_typeof("rating_configuration") = 'object'
        AND "rating_configuration" ?& ARRAY[
            'version', 'system', 'defaultRating', 'periodDays', 'glicko', 'elo', 'custom'
        ]
        AND jsonb_typeof("rating_configuration"->'version') = 'number'
        AND ("rating_configuration"->>'version')::integer = 1
        AND jsonb_typeof("rating_configuration"->'system') = 'string'
        AND "rating_configuration"->>'system' IN ('glicko', 'elo', 'custom')
        AND jsonb_typeof("rating_configuration"->'defaultRating') = 'number'
        AND ("rating_configuration"->>'defaultRating')::double precision BETWEEN 0 AND 1000000
        AND jsonb_typeof("rating_configuration"->'periodDays') = 'number'
        AND ("rating_configuration"->>'periodDays')::double precision BETWEEN (1.0 / 24.0) AND 3650
        AND jsonb_typeof("rating_configuration"->'glicko') = 'object'
        AND ("rating_configuration"->'glicko') ?& ARRAY[
            'initialDeviation', 'maxDeviation', 'periodDeviationIncrease', 'scale'
        ]
        AND jsonb_typeof("rating_configuration"->'glicko'->'initialDeviation') = 'number'
        AND ("rating_configuration"->'glicko'->>'initialDeviation')::double precision BETWEEN 1 AND 1000
        AND jsonb_typeof("rating_configuration"->'glicko'->'maxDeviation') = 'number'
        AND ("rating_configuration"->'glicko'->>'maxDeviation')::double precision BETWEEN 1 AND 1000
        AND ("rating_configuration"->'glicko'->>'initialDeviation')::double precision
            <= ("rating_configuration"->'glicko'->>'maxDeviation')::double precision
        AND jsonb_typeof("rating_configuration"->'glicko'->'periodDeviationIncrease') = 'number'
        AND ("rating_configuration"->'glicko'->>'periodDeviationIncrease')::double precision BETWEEN 0 AND 1000
        AND jsonb_typeof("rating_configuration"->'glicko'->'scale') = 'number'
        AND ("rating_configuration"->'glicko'->>'scale')::double precision BETWEEN 1 AND 10000
        AND jsonb_typeof("rating_configuration"->'elo') = 'object'
        AND ("rating_configuration"->'elo') ?& ARRAY['kFactor', 'scale']
        AND jsonb_typeof("rating_configuration"->'elo'->'kFactor') = 'number'
        AND ("rating_configuration"->'elo'->>'kFactor')::double precision BETWEEN 0.01 AND 1000
        AND jsonb_typeof("rating_configuration"->'elo'->'scale') = 'number'
        AND ("rating_configuration"->'elo'->>'scale')::double precision BETWEEN 1 AND 10000
        AND jsonb_typeof("rating_configuration"->'custom') = 'object'
        AND ("rating_configuration"->'custom') ? 'formula'
        AND jsonb_typeof("rating_configuration"->'custom'->'formula') = 'string'
        AND char_length("rating_configuration"->'custom'->>'formula') BETWEEN 1 AND 500
    );

CREATE POLICY "Game owners may update rating configuration"
    ON "public"."games"
    FOR UPDATE
    TO "authenticated"
    USING ("auth"."uid"() = "created_by")
    WITH CHECK ("auth"."uid"() = "created_by");

COMMENT ON COLUMN "public"."games"."rating_configuration" IS
    'Versioned rating settings. Application validation supplies and validates all algorithm-specific fields.';
