CREATE OR REPLACE FUNCTION requesting_user_id()
RETURNS TEXT AS $$
    SELECT NULLIF(
        current_setting('request.jwt.claims', true)::json->>'sub',
        ''
    )::text;
$$ LANGUAGE SQL STABLE;

ALTER TABLE "public"."profiles" MODIFY "user_id" "uuid" NOT NULL default requesting_user_id();
ALTER TABLE "public"."ratings" MODIFY "user_id" "uuid" NOT NULL default requesting_user_id();
