# Database restrictions

WaterJug exposes `public` through the Supabase Data API. Authorization is
enforced in two independent layers:

1. PostgreSQL grants restrict the operations and columns a Data API role may
   target.
2. Row Level Security (RLS) restricts the rows visible to an allowed
   operation.

`service_role` is server-only, bypasses RLS, and must never be shipped to a
browser. Server routes validate the caller before using it. The database also
limits privileged result-transition RPCs to `service_role`.

## Required access matrix

| Relation                  | Anonymous                        | Authenticated                                                                                                    | Row and column restrictions                                                                                                                                                                                                 |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `games`                   | Select accessible rows           | Select; insert `name`, `created_by`, `invite_only`, `rating_configuration`; update only configuration + revision | Public games are visible; private games require ownership or a matching invite. Only admins may create games, always as themselves. Only owners may atomically update rating configuration.                                 |
| `profiles`                | Select                           | Select; update only `display_name`, `username`                                                                   | Profiles are public. Only the owner can update; `user_id`, `created_at`, and `role` are not client-writable. Auth creates rows; only `service_role` can change roles.                                                       |
| `ratings`                 | Select in accessible games       | Select; insert initialization columns                                                                            | Callers may initialize only their own rating in an accessible game. Direct updates and deletes are denied so peer confirmation cannot be bypassed.                                                                          |
| `tournaments`             | Select in accessible games       | Select; insert application fields; update only `name`, `type`, `status`                                          | The caller must be the creator and have game access. Identity, game, creator, and timestamp are immutable through the API.                                                                                                  |
| `tournament_participants` | Select in accessible tournaments | Select; insert only tournament + user                                                                            | Only the tournament creator may add participants. Timestamps, updates, and deletes are unavailable.                                                                                                                         |
| `game_invites`            | No visible rows                  | Select; insert invite fields; delete                                                                             | Only creators can add/remove invites. Creators see their invites; invitees see only rows matching the signed JWT email. The anonymous table grant exists solely for the games-policy lookup and has no matching row policy. |
| `game_results`            | None                             | Select participant rows; insert only report identity fields                                                      | Current participants in an accessible game may report. Trigger-owned status, snapshots, review fields, timestamps, updates, and deletes are unavailable.                                                                    |

All seven relations have RLS enabled. Public access is intentional for profiles
and for games, ratings, tournaments, and participants whose containing game is
public. Revoking an invite immediately hides its private game, ratings,
tournaments, participants, and results.

## RPC and function boundaries

| Function                                    | Boundary                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_game(text, boolean, text[], jsonb)` | Authenticated, security-invoker. The admin/owner insert policy remains authoritative for both RPC and direct Data API calls.                                                                |
| `ensure_game_rating(bigint)`                | Authenticated, security-invoker. Derives `user_id` from `auth.uid()`, snapshots the accessible game's current defaults, and is idempotent.                                                  |
| `apply_rating_result(...)`                  | `service_role` only. Atomic compare-and-set compatibility RPC.                                                                                                                              |
| `review_game_result(...)`                   | `service_role` only, security-definer. Enforces opponent review, invite eligibility, pending-to-terminal transitions, snapshots, configuration revision, and rating compare-and-set checks. |
| `handle_new_user()`                         | Auth trigger only, security-definer.                                                                                                                                                        |
| `prepare_game_result()`                     | Trigger only, security-invoker. Derives the reporter and snapshots state while holding the per-game transaction lock.                                                                       |
| `prevent_profile_role_change()`             | Trigger only. Rejects role changes unless the database role is `service_role`.                                                                                                              |

Every function has an empty `search_path`; public default execution is revoked.
The revision trigger is stored in the non-exposed `private` schema. All
functions are owned by `postgres`; only `handle_new_user` and
`review_game_result` are security-definer.

## Persisted invariants

- Game and tournament names contain a non-whitespace character.
- Rating configuration has exactly the version-1 object shape, supported
  `glicko`/`elo`/`custom` system, bounded finite settings, valid Glicko
  deviation ordering, rating period, Elo parameters, and a non-blank formula
  of at most 500 characters.
- Configuration and revision change together: configuration changes increment
  the positive revision by exactly one; revision-only writes fail.
- Ratings and result snapshots are finite; rating types are supported; rating
  metadata and result JSON snapshots are objects.
- Result reporters are participants, winner and loser differ, and reviews move
  a pending result exactly once to `confirmed` or `disputed`.
- Confirmation requires unchanged configuration and player snapshots, then
  updates both ratings and the terminal result in one transaction.
- Invite email normalization, ownership, revocation, and cross-game foreign
  keys are enforced independently of application validation.
- Profile roles, profile ownership, game ownership, tournament identity, result
  snapshots, and generated timestamps are not writable by end users.

Foreign-key and RLS lookup columns have leading indexes. RLS policies wrap
`auth.uid()` and `auth.jwt()` in scalar subqueries so PostgreSQL evaluates them
once per statement.

## Verification

The SQL suite contains 192 top-level pgTAP assertions across eight files.
Generated loops and property tests cover more cases without inflating TAP
counts:

- An exhaustive 8 actor × 8 owner matrix checks six operations per pairing
  (384 decisions): profile updates, denied direct rating updates, tournament
  updates, game creation, tournament creation, and participant insertion.
- Generated malformed/null names, JWT subjects, types, states, floating-point
  values, metadata, configuration shapes, exact keys, bounds, formula sizes,
  and foreign-key targets fail closed.
- Invite tests cover admin/player creation, normalization, public/invited/
  outsider visibility, revocation, forged ownership, direct join bypasses, and
  concurrent invited/outsider joins.
- Result tests cover forged identities, cross-game participants, immutable
  snapshots, every pending/confirmed/disputed transition, replay idempotency,
  stale rating/configuration rejection, invite revocation, and service-only
  review execution.
- Independent `dblink` sessions exercise non-owner lock filtering, duplicate
  participant insertion, configuration compare-and-set races, and committed
  outcomes.
- Database-backed Vitest adds generated result-transition traces, authorization
  matrices, username races, default-rating snapshot races, and invite races.
- Application FastCheck suites cover formula fuzzing, malformed IDs, rating
  configuration, Glicko/Elo/period boundaries, roles, profiles, and invites.

Run the complete local database verification:

```sh
bunx supabase db reset --local
bun run test:db
bunx supabase db lint --local --level warning
bunx supabase db advisors --local --type security
bunx supabase db advisors --local --type performance
bun run update-types
```

The final migration order is:

1. rating configuration (`20260724000000`)
2. usernames (`20260725000000`)
3. default-rating RPC (`20260725005000`)
4. roles and privileged rating RPC (`20260725010000`)
5. invite-only games (`20260725020000`)
6. peer-checked results (`20260725055357`)
7. public-profile constraints (`20260726000000`)
8. consolidated final restrictions (`20260726010000`)

## Limitations

- pgTAP sets PostgreSQL roles and JWT claims directly. Signed-token rejection is
  exercised by database-backed Supabase client tests, not reimplemented in SQL.
- Public profile SELECT currently includes the application role. Roles are
  authorization inputs, not secrets; role mutation remains service-only.
- The merged display-name constraints are `NOT VALID`: new and changed rows are
  checked, but pre-existing rows are not retroactively scanned.
- Tournament statuses are constrained to declared values, but the product does
  not yet define a stricter lifecycle graph, so the database does not invent
  one.
- Custom formula parsing remains application behavior. Formula evaluation runs
  in a dedicated Node worker with an empty environment, a one-second deadline,
  and V8 heap/stack/code limits. PostgreSQL enforces persisted structure, size,
  and numeric boundaries; unit/property/fuzz tests enforce formula grammar,
  finite evaluation, worker equivalence, and deadline termination.
- Race tests cover conflicting transactions and final committed state, not
  performance, soak, or distributed load.
