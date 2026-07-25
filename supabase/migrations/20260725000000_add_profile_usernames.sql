ALTER TABLE "public"."profiles"
    ADD COLUMN "username" text;

ALTER TABLE "public"."profiles"
    ADD CONSTRAINT "profiles_username_format_check"
    CHECK (
        "username" IS NULL
        OR "username" ~ '^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$'
    );

CREATE UNIQUE INDEX "profiles_username_unique"
    ON "public"."profiles" (LOWER("username"))
    WHERE "username" IS NOT NULL;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    requested_username text;
BEGIN
    requested_username := LOWER(TRIM(new.raw_user_meta_data ->> 'username'));

    INSERT INTO public.profiles (user_id, username)
    VALUES (new.id, NULLIF(requested_username, ''));
    RETURN new;
END;
$$;

COMMENT ON COLUMN "public"."profiles"."username" IS
    'Optional public username. Stored lowercase and unique case-insensitively.';
