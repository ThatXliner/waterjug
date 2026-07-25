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
       AND auth.role() IS DISTINCT FROM 'service_role' THEN
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
