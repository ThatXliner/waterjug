# Database restrictions

WaterJug exposes the `public` schema through the Supabase Data API. Access is
therefore enforced in two layers:

1. PostgreSQL grants decide which operations the `anon` and `authenticated`
   roles may attempt.
2. Row Level Security (RLS) policies decide which rows an allowed operation may
   affect.

The server-only `service_role` remains privileged and bypasses RLS. It must
never be used in a browser or treated as a substitute for a missing end-user
policy.

## Required access matrix

| Table                     | Anonymous | Authenticated                                                                                                                      | Row restriction                                                                                                                                                |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games`                   | Select    | Select; insert `name`, `created_by`, and `rating_configuration`; update `rating_configuration` and `rating_configuration_revision` | A new game must be owned by `auth.uid()`. Only its owner may update rating settings; identity, ownership, name, timestamp, and initial revision are protected. |
| `profiles`                | Select    | Select; update `display_name` and `username`                                                                                       | A user may update only their own row. `user_id` and `created_at` are immutable to API users. Rows are inserted only by the Auth trigger.                       |
| `ratings`                 | Select    | Select, insert, update                                                                                                             | A user may insert or update only a row whose `user_id` equals `auth.uid()`. Delete is unavailable.                                                             |
| `tournaments`             | Select    | Select, insert, update                                                                                                             | `created_by` must equal `auth.uid()` on insert and remain so on update. Only the creator can update the row. Delete is unavailable.                            |
| `tournament_participants` | Select    | Select, insert                                                                                                                     | Only the tournament creator may add participants. Update and delete are unavailable.                                                                           |

All five tables must have RLS enabled. Public select access is intentional:
games, ratings, display names, tournaments, and participant lists are product
data shown on public game and profile pages.

Database values must also preserve these invariants:

- Game and tournament names contain at least one non-whitespace character.
- A game rating configuration has exactly the documented version-1 object
  shape, valid bounded numeric values, a supported system, and a non-blank
  formula of at most 500 characters.
- Rating configuration and revision updates are atomic: a changed configuration
  increments the positive revision by exactly one, and the revision cannot
  change on its own. This preserves the application's compare-and-set contract
  under concurrent owner updates.
- Ratings are finite IEEE-754 values; `NaN` and positive/negative infinity are
  rejected.
- Rating metadata is a JSON object.
- Tournament type and status stay within their declared enum-like check
  constraints.

The `public.handle_new_user()` security-definer function exists only for the
`auth.users` trigger. It uses an empty `search_path` and is not executable by
Data API roles.

The `public.ensure_game_rating(bigint)` RPC is deliberately executable only by
`authenticated`. It is security-invoker, uses an empty `search_path`, derives
the inserted `user_id` from `auth.uid()`, and relies on the rating insert policy
plus the `(user_id, game_id)` key for owner isolation and idempotency.

## Verification

The pgTAP suite in
`supabase/tests/` contains 99 top-level assertions across four files. Generated assertions
exercise many cases internally rather than inflating the TAP count. The suite
verifies:

- RLS is enabled on every exposed application table.
- Table, column, sequence, and function privileges match the matrix.
- Anonymous reads succeed and anonymous writes fail.
- Authenticated owner operations succeed.
- Cross-user profile, rating, tournament, and participant operations fail.
- An `authenticated` database role without a JWT user identity cannot create a
  game.
- An exhaustive generated matrix covers every pairing of eight actors and
  eight resource owners across game creation, profile and rating updates,
  tournament creation and updates, and participant insertion (384 policy
  decisions).
- Generated malformed names, identities, states, types, rating values, and JSON
  shapes fail closed while valid numeric boundaries remain accepted.
- Generated rating-configuration cases cover missing, null, array, extra-key,
  wrong-type, fractional-version, out-of-range, and blank/oversized formula
  inputs, plus all accepted numeric and formula-length boundaries.
- Independent database sessions verify that non-owner updates and participant
  inserts cannot win or block on concurrent owner transactions, and that two
  authorized inserts of the same participant serialize to exactly one row.
- Independent owner sessions racing the same rating-configuration revision
  serialize to one committed winner; a non-owner is filtered without waiting,
  and the stale owner compare-and-set affects zero rows.

Run the database checks against the local Supabase stack:

```sh
supabase start
supabase db reset
supabase test db
```

The July 25 migrations intentionally use distinct versions in dependency order:
profile usernames at `20260725000000`, the default-rating RPC at
`20260725010000`, and this consolidated hardening at `20260725055352`.

The tests run inside a transaction and roll back all fixture users and data.
The concurrency suite uses separately committed, uniquely keyed fixtures
because independent sessions cannot observe the pgTAP transaction; it removes
those fixtures before finishing.

## Limitations

- Tests model the database roles and JWT subject claim directly. Supabase's JWT
  signature verification is an API/Auth concern and is not duplicated here.
- Public reads are intentional and are not treated as tenant-private data.
- The database constrains valid tournament status values, but product semantics
  do not yet define a stricter lifecycle graph (for example, whether
  `completed` may return to `active`), so tests cover the current
  `pending` → `active` → `completed` path without inventing transition rules.
- The race suite covers conflicting owner/non-owner writes, duplicate
  authorized inserts, rating-configuration compare-and-set updates, lock
  behavior, and committed outcomes. It does not attempt performance, soak, or
  load testing.
- PostgreSQL validates the persisted rating-configuration structure, bounds,
  system name, and formula string size. Parsing and safely evaluating custom
  formula syntax remains application-library behavior and is covered by the
  rating unit and property tests.
