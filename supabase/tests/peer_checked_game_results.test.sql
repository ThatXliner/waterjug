BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

INSERT INTO auth.users (id, email)
VALUES
    ('00000000-0000-0000-0000-000000000101', 'reporter@example.test'),
    ('00000000-0000-0000-0000-000000000102', 'opponent@example.test'),
    ('00000000-0000-0000-0000-000000000103', 'outsider@example.test');

INSERT INTO public.games (game_id, name)
VALUES (9001, 'Peer review test game');

INSERT INTO public.ratings (game_id, user_id, rating, other_data)
VALUES
    (
        9001,
        '00000000-0000-0000-0000-000000000101',
        1200,
        '{"rd": 350}'::json
    ),
    (
        9001,
        '00000000-0000-0000-0000-000000000102',
        1200,
        '{"rd": 350}'::json
    );

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

SELECT is(
    has_function_privilege(
        'anon',
        'public.review_game_result(bigint, text)',
        'EXECUTE'
    ),
    false,
    'unauthenticated clients cannot invoke the review function'
);

SELECT is(
    has_table_privilege('authenticated', 'public.game_results', 'UPDATE'),
    false,
    'clients cannot bypass the review function with direct updates'
);

SELECT lives_ok(
    $$
        INSERT INTO public.game_results (
            result_id,
            game_id,
            reporter_id,
            winner_id,
            loser_id
        )
        VALUES (
            9101,
            9001,
            '00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000102'
        )
    $$,
    'a player can report a pending result'
);

SELECT is(
    (
        SELECT status
        FROM public.game_results
        WHERE result_id = 9101
    ),
    'pending',
    'a newly reported result is pending'
);

RESET ROLE;

SELECT is(
    (
        SELECT rating
        FROM public.ratings
        WHERE game_id = 9001
          AND user_id = '00000000-0000-0000-0000-000000000101'
    ),
    1200::double precision,
    'reporting does not change the winner rating'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

SELECT throws_ok(
    $$ SELECT public.review_game_result(9101, 'confirm') $$,
    'Only the opposing player can review this result',
    'the reporter cannot confirm their own result'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000103';

SELECT is(
    (
        SELECT count(*)::integer
        FROM public.game_results
        WHERE result_id = 9101
    ),
    0,
    'unrelated players cannot see the result'
);

SELECT throws_ok(
    $$ SELECT public.review_game_result(9101, 'confirm') $$,
    'Only the opposing player can review this result',
    'unrelated players cannot review the result'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';

SELECT is(
    (
        SELECT count(*)::integer
        FROM public.game_results
        WHERE result_id = 9101
    ),
    1,
    'the opposing player can see the reported result'
);

SELECT lives_ok(
    $$ SELECT public.review_game_result(9101, 'confirm') $$,
    'the opposing player can confirm the result'
);

SELECT is(
    (
        SELECT status
        FROM public.game_results
        WHERE result_id = 9101
    ),
    'confirmed',
    'confirmation finalizes the result'
);

RESET ROLE;

SELECT ok(
    (
        SELECT rating > 1200
        FROM public.ratings
        WHERE game_id = 9001
          AND user_id = '00000000-0000-0000-0000-000000000101'
    ),
    'confirmation increases the winner rating'
);

SELECT ok(
    (
        SELECT rating < 1200
        FROM public.ratings
        WHERE game_id = 9001
          AND user_id = '00000000-0000-0000-0000-000000000102'
    ),
    'confirmation decreases the loser rating'
);

CREATE TEMP TABLE ratings_after_confirm AS
SELECT user_id, rating
FROM public.ratings
WHERE game_id = 9001;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';

SELECT lives_ok(
    $$ SELECT public.review_game_result(9101, 'confirm') $$,
    'a matching confirmation replay is an idempotent no-op'
);

RESET ROLE;

SELECT results_eq(
    $$
        SELECT user_id, rating
        FROM public.ratings
        WHERE game_id = 9001
        ORDER BY user_id
    $$,
    $$
        SELECT user_id, rating
        FROM ratings_after_confirm
        ORDER BY user_id
    $$,
    'a confirmation replay cannot apply ratings twice'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';

SELECT throws_ok(
    $$ SELECT public.review_game_result(9101, 'dispute') $$,
    'Result has already been reviewed',
    'a confirmed result rejects a conflicting dispute'
);

RESET ROLE;

INSERT INTO public.game_results (
    result_id,
    game_id,
    reporter_id,
    winner_id,
    loser_id
)
VALUES (
    9102,
    9001,
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102'
);

CREATE TEMP TABLE ratings_before_dispute AS
SELECT user_id, rating
FROM public.ratings
WHERE game_id = 9001;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000102';

SELECT throws_ok(
    $$ SELECT public.review_game_result(9102, 'invalid') $$,
    'Decision must be confirm or dispute',
    'an invalid decision cannot transition a pending result'
);

SELECT lives_ok(
    $$ SELECT public.review_game_result(9102, 'dispute') $$,
    'the opposing player can dispute the result'
);

SELECT lives_ok(
    $$ SELECT public.review_game_result(9102, 'dispute') $$,
    'a matching dispute replay is an idempotent no-op'
);

RESET ROLE;

SELECT results_eq(
    $$
        SELECT user_id, rating
        FROM public.ratings
        WHERE game_id = 9001
        ORDER BY user_id
    $$,
    $$
        SELECT user_id, rating
        FROM ratings_before_dispute
        ORDER BY user_id
    $$,
    'disputing leaves both ratings unchanged'
);

SELECT * FROM finish();

ROLLBACK;
