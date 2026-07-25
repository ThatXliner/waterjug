ALTER TABLE "public"."profiles"
    ADD CONSTRAINT "profiles_display_name_length"
    CHECK (char_length("display_name") <= 50)
    NOT VALID;

ALTER TABLE "public"."profiles"
    ADD CONSTRAINT "profiles_display_name_no_control_characters"
    CHECK ("display_name" !~ '[[:cntrl:]]')
    NOT VALID;

DROP POLICY IF EXISTS "Enable read access for own profile" ON "public"."profiles";
DROP POLICY IF EXISTS "Enable update for own profile" ON "public"."profiles";

CREATE POLICY "Public profiles are viewable"
    ON "public"."profiles"
    FOR SELECT
    TO "anon", "authenticated"
    USING (true);

CREATE POLICY "Users can update their own profile"
    ON "public"."profiles"
    FOR UPDATE
    TO "authenticated"
    USING ("auth"."uid"() = "user_id")
    WITH CHECK ("auth"."uid"() = "user_id");

COMMENT ON TABLE "public"."profiles" IS
    'Public profile fields. Inserts are created by handle_new_user; only owners may update.';
