<p align="center">
  <a href="https://waterjug.vercel.app/">
    <img src="./static/waterjug.png" width="180" alt="WaterJug logo" />
  </a>
</p>

<h1 align="center">WaterJug</h1>

<p align="center">
  <strong>Turn any rivalry into a leaderboard.</strong>
</p>

<p align="center">
  A lightweight, game-agnostic rating tracker powered by Glicko.<br />
  Create a ladder, invite the competition, and let the numbers settle it.
</p>

<p align="center">
  <a href="https://waterjug.vercel.app/"><strong>Try WaterJug ↗</strong></a>
  ·
  <a href="#quick-start">Run it locally</a>
  ·
  <a href="#roadmap">See what is next</a>
</p>

<p align="center">
  <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte_5-FF3E00?style=flat-square&logo=svelte&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white" />
  <img alt="Bun" src="https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white" />
</p>

---

## Why WaterJug?

Most rating apps are built around one game. WaterJug starts with the people instead: make a shared ladder for chess, table tennis, office foosball, fighting games, or whatever your group is currently taking far too seriously.

- **One ladder per game** — create a game and get a dedicated, ranked leaderboard.
- **Ratings that understand uncertainty** — an in-house Glicko implementation tracks both rating and rating deviation.
- **Fast result reporting** — record a head-to-head result and update both players immediately.
- **A face behind every score** — display names and public profiles keep the leaderboard readable.
- **Tournament foundations** — create bracket or round-robin events and choose their participants.
- **Supabase-backed** — authentication, Postgres persistence, and row-level security are built in.

> [!NOTE]
> WaterJug is in active development. Core ladders and rating updates work today; tournament play, peer verification, and deeper analytics are still being built.

## How it works

1. **Create a game.** A fresh ladder starts at a default rating of `1200`.
2. **Join the competition.** Visiting a game adds the signed-in player to its leaderboard.
3. **Report the result.** Glicko recalculates both players' ratings and rating deviations.

No game-specific rules. No spreadsheets. Just a shared answer to _“okay, but who is actually better?”_

## Quick start

### Prerequisites

- [Bun](https://bun.sh/) for dependencies and scripts
- [Docker](https://docs.docker.com/get-docker/) or another Docker-compatible runtime for local Supabase

### 1. Install and start the services

```bash
git clone https://github.com/ThatXliner/waterjug.git
cd waterjug
bun install
bunx supabase start
```

### 2. Configure the environment

Ask the local Supabase stack for its credentials:

```bash
bunx supabase status -o env
```

Create `.env.local` in the project root using the values from that output:

```dotenv
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it through a `PUBLIC_` variable or commit your environment file.

### 3. Launch WaterJug

```bash
bun run dev
```

Open [localhost:5173](http://localhost:5173), create an account, and start a ladder. Supabase Studio is available at [localhost:54323](http://localhost:54323).

## Under the hood

| Layer   | Technology               | What it does                                       |
| ------- | ------------------------ | -------------------------------------------------- |
| App     | SvelteKit 2 + Svelte 5   | Routes, server actions, and reactive UI            |
| UI      | Tailwind CSS 4 + daisyUI | Layout, components, and theming                    |
| Data    | Supabase + Postgres      | Auth, relational data, and row-level security      |
| Ratings | TypeScript               | In-house Glicko calculations with rating deviation |
| Tests   | Vitest + Playwright      | Unit and browser-level coverage                    |
| Runtime | Bun + Vite               | Package management and local development           |

```text
src/
├── lib/glicko.ts              # Rating engine
├── routes/dashboard/          # Player's games and profile settings
├── routes/game/new/           # Ladder creation
├── routes/game/play/[id=id]/  # Leaderboard, results, and tournaments
└── routes/profile/[id=uuid]/  # Public player profiles

supabase/
├── migrations/                # Schema, policies, profiles, and tournaments
└── seed.sql                   # Local development data
```

## Scripts

| Command                    | Purpose                               |
| -------------------------- | ------------------------------------- |
| `bun run dev`              | Start the development server          |
| `bun run build`            | Create a production build             |
| `bun run check`            | Run Svelte and TypeScript diagnostics |
| `bun run lint`             | Check formatting and lint rules       |
| `bun run test:unit --run`  | Run the Vitest suite once             |
| `bun run test:integration` | Run Playwright integration tests      |
| `bun run update-types`     | Regenerate Supabase database types    |

## Roadmap

- [x] Game-agnostic rating ladders
- [x] Glicko rating updates
- [x] Email authentication and display names
- [x] Public player profiles
- [x] Bracket and round-robin tournament creation
- [ ] Playable tournament brackets and round-robin scheduling
- [ ] Peer-verified results
- [ ] Invite-only games
- [ ] Rating history, predictions, and analytics
- [ ] Real-time leaderboard updates
- [x] Configurable rating systems
  - [x] Configurable default rating
  - [x] Configurable rating period
  - [x] Parameters for the Glicko system
  - [x] Parameters for the Elo system
  - [x] Safely evaluated custom formulas
- [ ] Hardened and fully tested database policies

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

## Contributing

WaterJug is young, opinionated, and open to improvement. Before opening a pull request:

```bash
bun run check
bun run lint
bun run test:unit --run
```

For changes to the database, add a migration under `supabase/migrations/` and regenerate `src/lib/supabase.ts`.

---

<p align="center">
  Built for friendly competition. Maintained for the inevitable rematch.
</p>
