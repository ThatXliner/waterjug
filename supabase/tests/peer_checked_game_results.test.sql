BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(40);

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'reporter@example.test'),
  ('00000000-0000-0000-0000-000000000102', 'opponent@example.test'),
  ('00000000-0000-0000-0000-000000000103', 'outsider@example.test');

INSERT INTO public.games (
  game_id,
  name,
  created_by,
  invite_only,
  rating_configuration_revision
)
VALUES
  (9001, 'Public peer review game', '00000000-0000-0000-0000-000000000101', false, 7),
  (9002, 'Private peer review game', '00000000-0000-0000-0000-000000000101', true, 3),
  (9003, 'Cross-game isolation fixture', '00000000-0000-0000-0000-000000000103', false, 1);

INSERT INTO public.game_invites (game_id, invited_email, invited_by)
VALUES (9002, 'opponent@example.test', '00000000-0000-0000-0000-000000000101');

INSERT INTO public.ratings (game_id, user_id, rating, type, other_data)
VALUES
  (9001, '00000000-0000-0000-0000-000000000101', 1200, 'glicko', '{"deviation": 350}'::json),
  (9001, '00000000-0000-0000-0000-000000000102', 1200, 'glicko', '{"deviation": 350}'::json),
  (9002, '00000000-0000-0000-0000-000000000101', 1300, 'elo', '{}'::json),
  (9002, '00000000-0000-0000-0000-000000000102', 1100, 'elo', '{}'::json),
  (9003, '00000000-0000-0000-0000-000000000103', 1400, 'glicko', '{}'::json);

SELECT is(
  has_function_privilege(
    'anon',
    'public.review_game_result(bigint,uuid,text,bigint,double precision,text,jsonb,double precision,text,jsonb)',
    'EXECUTE'
  ),
  false,
  'anonymous clients cannot invoke result review'
);

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.review_game_result(bigint,uuid,text,bigint,double precision,text,jsonb,double precision,text,jsonb)',
    'EXECUTE'
  ),
  false,
  'authenticated clients cannot invoke the privileged review transition'
);

SELECT is(
  has_table_privilege('authenticated', 'public.game_results', 'UPDATE'),
  false,
  'clients cannot bypass the state machine with direct updates'
);

SELECT is(
  has_column_privilege('authenticated', 'public.game_results', 'status', 'INSERT'),
  false,
  'clients cannot choose an initial result status'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

SELECT lives_ok(
  $$
    INSERT INTO public.game_results (
      game_id, reporter_id, submission_id, winner_id, loser_id
    )
    VALUES (
      9001,
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    )
  $$,
  'a participant can report a result'
);

SELECT is(
  (SELECT status FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  'pending',
  'new reports always begin pending'
);

SELECT is(
  (SELECT configuration_revision FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  7::bigint,
  'the report snapshots the current configuration revision'
);

SELECT is(
  (SELECT rating_configuration_snapshot ->> 'system' FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  'glicko',
  'the report snapshots the calculation configuration'
);

SELECT is(
  (SELECT winner_rating_snapshot FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  1200::double precision,
  'the report snapshots the winner rating'
);

SELECT is(
  (SELECT loser_rating_snapshot FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  1200::double precision,
  'the report snapshots the loser rating'
);

SELECT is(
  (SELECT count(*)::integer FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'the reporter can see the pending result'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';

SELECT is(
  (SELECT count(*)::integer FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'the opponent can see the reported result'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

SELECT is(
  (SELECT count(*)::integer FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  0,
  'an unrelated player cannot see the result'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
      '00000000-0000-0000-0000-000000000101',
      'confirmed', 7, 1220, 'glicko', '{"deviation": 340}'::jsonb,
      1180, 'glicko', '{"deviation": 340}'::jsonb
    )
  $$,
  '42501',
  'Only the opponent can review this result',
  'the reporter cannot confirm their own claim'
);

SELECT throws_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
      '00000000-0000-0000-0000-000000000103',
      'confirmed', 7, 1220, 'glicko', '{}'::jsonb,
      1180, 'glicko', '{}'::jsonb
    )
  $$,
  '42501',
  'Only the opponent can review this result',
  'an outsider cannot review another game result'
);

SELECT lives_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
      '00000000-0000-0000-0000-000000000102',
      'confirmed', 7, 1220, 'glicko', '{"deviation": 340}'::jsonb,
      1180, 'glicko', '{"deviation": 340}'::jsonb
    )
  $$,
  'the opponent can confirm a pending result'
);

SELECT is(
  (SELECT status FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  'confirmed',
  'confirmation finalizes the result'
);

SELECT is(
  (SELECT reviewed_by FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-000000000102'::uuid,
  'the final transition records the opponent'
);

SELECT is(
  (SELECT rating FROM public.ratings
   WHERE game_id = 9001 AND user_id = '00000000-0000-0000-0000-000000000101'),
  1220::double precision,
  'confirmation applies the calculated winner rating'
);

SELECT is(
  (SELECT rating FROM public.ratings
   WHERE game_id = 9001 AND user_id = '00000000-0000-0000-0000-000000000102'),
  1180::double precision,
  'confirmation applies the calculated loser rating'
);

SELECT lives_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
      '00000000-0000-0000-0000-000000000102',
      'confirmed', 7, 9999, 'elo', '{}'::jsonb,
      1, 'elo', '{}'::jsonb
    )
  $$,
  'a matching confirmation replay is an idempotent no-op'
);

SELECT is(
  (SELECT rating FROM public.ratings
   WHERE game_id = 9001 AND user_id = '00000000-0000-0000-0000-000000000101'),
  1220::double precision,
  'a confirmation replay cannot apply ratings twice'
);

SELECT throws_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000001'),
      '00000000-0000-0000-0000-000000000102',
      'disputed', 7
    )
  $$,
  '22023',
  'Result has already been reviewed as confirmed',
  'a terminal result rejects a conflicting replay'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

SELECT lives_ok(
  $$
    INSERT INTO public.game_results (
      game_id, reporter_id, submission_id, winner_id, loser_id
    )
    VALUES (
      9001,
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    )
  $$,
  'a new submission key creates one report'
);

SELECT throws_ok(
  $$
    INSERT INTO public.game_results (
      game_id, reporter_id, submission_id, winner_id, loser_id
    )
    VALUES (
      9001,
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    )
  $$,
  '23505',
  NULL,
  'a replayed report key is rejected by the database'
);

SELECT is(
  (SELECT count(*)::integer FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000002'),
  1,
  'a replay cannot duplicate a report'
);

SELECT throws_ok(
  $$
    INSERT INTO public.game_results (
      game_id, reporter_id, submission_id, winner_id, loser_id
    )
    VALUES (
      9001,
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000103'
    )
  $$,
  '23503',
  'Both players must have a rating in this game',
  'ratings from another game cannot be smuggled into a result'
);

RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.ratings
SET rating = 1221
WHERE game_id = 9001
  AND user_id = '00000000-0000-0000-0000-000000000101';

SELECT throws_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000002'),
      '00000000-0000-0000-0000-000000000102',
      'confirmed', 7, 1240, 'glicko', '{}'::jsonb,
      1160, 'glicko', '{}'::jsonb
    )
  $$,
  'PT409',
  'A participant rating changed after this result was reported',
  'confirmation rejects a stale rating snapshot'
);

SELECT is(
  (SELECT status FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000002'),
  'pending',
  'a stale confirmation rolls back without changing state'
);

SELECT lives_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000002'),
      '00000000-0000-0000-0000-000000000102',
      'disputed', 7
    )
  $$,
  'a stale result can still be disputed'
);

SELECT is(
  (SELECT status FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000002'),
  'disputed',
  'dispute finalizes without applying stale ratings'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

SELECT lives_ok(
  $$
    INSERT INTO public.game_results (
      game_id, reporter_id, submission_id, winner_id, loser_id
    )
    VALUES (
      9001,
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000004',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    )
  $$,
  'a fresh report captures the current ratings'
);

RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.games
SET rating_configuration_revision = 8
WHERE game_id = 9001;

SELECT throws_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000004'),
      '00000000-0000-0000-0000-000000000102',
      'confirmed', 7, 1240, 'glicko', '{}'::jsonb,
      1160, 'glicko', '{}'::jsonb
    )
  $$,
  'PT409',
  'Rating configuration changed after this result was reported',
  'confirmation rejects a stale configuration revision'
);

SELECT is(
  (SELECT status FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000004'),
  'pending',
  'a configuration conflict leaves the result pending'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

SELECT lives_ok(
  $$
    INSERT INTO public.game_results (
      game_id, reporter_id, submission_id, winner_id, loser_id
    )
    VALUES (
      9002,
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000005',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    )
  $$,
  'the owner can report against an invited player'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';
SET LOCAL request.jwt.claims =
  '{"sub":"00000000-0000-0000-0000-000000000102","email":"opponent@example.test"}';

SELECT is(
  (SELECT count(*)::integer FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000005'),
  1,
  'a currently invited opponent can see the report'
);

RESET ROLE;
SET LOCAL ROLE service_role;

DELETE FROM public.game_invites
WHERE game_id = 9002
  AND invited_email = 'opponent@example.test';

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';

SELECT is(
  (SELECT count(*)::integer FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000005'),
  0,
  'invite revocation immediately hides the private result'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000005'),
      '00000000-0000-0000-0000-000000000102',
      'disputed', 3
    )
  $$,
  '42501',
  'Reviewer no longer has access to this private game',
  'invite revocation prevents privileged result transitions too'
);

INSERT INTO public.game_invites (game_id, invited_email, invited_by)
VALUES (9002, 'opponent@example.test', '00000000-0000-0000-0000-000000000101');

SELECT lives_ok(
  $$
    SELECT public.review_game_result(
      (SELECT id FROM public.game_results
       WHERE submission_id = '10000000-0000-0000-0000-000000000005'),
      '00000000-0000-0000-0000-000000000102',
      'disputed', 3
    )
  $$,
  'restored eligibility permits the opponent to dispute'
);

SELECT is(
  (SELECT status FROM public.game_results
   WHERE submission_id = '10000000-0000-0000-0000-000000000005'),
  'disputed',
  'the private result reaches one terminal state'
);

SELECT * FROM finish();

ROLLBACK;
