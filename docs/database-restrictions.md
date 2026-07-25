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

| Table                     | Anonymous | Authenticated                 | Row restriction                                                                                                                          |
| ------------------------- | --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `games`                   | Select    | Select, insert                | An insert requires a non-null `auth.uid()`; update and delete are unavailable.                                                           |
| `profiles`                | Select    | Select, update `display_name` | A user may update only their own row. `user_id` and `created_at` are immutable to API users. Rows are inserted only by the Auth trigger. |
| `ratings`                 | Select    | Select, insert, update        | A user may insert or update only a row whose `user_id` equals `auth.uid()`. Delete is unavailable.                                       |
| `tournaments`             | Select    | Select, insert, update        | `created_by` must equal `auth.uid()` on insert and remain so on update. Only the creator can update the row. Delete is unavailable.      |
| `tournament_participants` | Select    | Select, insert                | Only the tournament creator may add participants. Update and delete are unavailable.                                                     |

All five tables must have RLS enabled. Public select access is intentional:
games, ratings, display names, tournaments, and participant lists are product
data shown on public game and profile pages.

The `public.handle_new_user()` security-definer function exists only for the
`auth.users` trigger. It uses an empty `search_path` and is not executable by
Data API roles.

## Verification

The pgTAP suite in
`supabase/tests/database_restrictions.test.sql` verifies:

- RLS is enabled on every exposed application table.
- Table, column, sequence, and function privileges match the matrix.
- Anonymous reads succeed and anonymous writes fail.
- Authenticated owner operations succeed.
- Cross-user profile, rating, tournament, and participant operations fail.
- An `authenticated` database role without a JWT user identity cannot create a
  game.

Run the database checks against the local Supabase stack:

```sh
supabase start
supabase db reset
supabase test db
```

The tests run inside a transaction and roll back all fixture users and data.
