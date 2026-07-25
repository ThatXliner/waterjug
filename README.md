# WaterJug

![](./src/lib/assets/waterjug.png)

TODO:

- [ ] Invite-only games
- [ ] User profiles
- [ ] Actually check and test the DB restrictions
- [ ] Peer-checked game win/loss
- [ ] Fix roles (and client vs server Supabase client)
- [x] Configurable rating systems
  - [x] Configurable default rating
  - [x] Configurable rating period
  - [x] Parameters for the Glicko system
  - [x] Parameters for the Elo system
  - [x] Safely evaluated custom formulas

## Rating configuration

Each game stores one versioned rating configuration. Game owners choose Glicko, Elo, or a
custom formula when creating a game and can change the configuration later without rewriting
existing player ratings. New players receive the configured starting rating.

- Glicko supports rating-period length, initial and maximum deviation, deviation increase per
  inactive period, and rating scale.
- Elo supports K-factor and rating scale.
- Custom formulas return a player's new rating. They may use `rating`, `opponentRating`, `score`,
  and `expected`, along with arithmetic and `abs`, `min`, `max`, `pow`, `round`, `floor`, and
  `ceil`. Formulas are parsed by a restricted expression evaluator; JavaScript access, property
  access, assignment, and other functions are not supported.
