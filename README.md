# WC 2026 Tulosveto

A private score-betting app for a small group of friends to play during the
2026 World Cup: predict match scores, pick your tournament podium + top
scorer, and track everyone on a shared leaderboard.

**Stack:** React + Vite + TypeScript + Tailwind · Supabase (Postgres, Auth,
RLS, Edge Functions) · deployed as a single static site (Vercel/Netlify).

## Project status

- [x] Project scaffold (Vite + React + TS + Tailwind v4)
- [x] Supabase schema + RLS migrations (`supabase/migrations/`)
- [ ] Auth (magic link sign-in + display names)
- [ ] Fixture/result sync from football-data.org
- [ ] Per-match score betting
- [ ] Tournament bets (podium + top scorer)
- [ ] Leaderboard + standings/bracket views

## Local setup

1. **Install dependencies**

   ```sh
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier).

3. **Run the migrations** — either via the Supabase CLI (`supabase link` then
   `supabase db push`), or by pasting each file in `supabase/migrations/`
   **in filename order** into the SQL editor in your project's dashboard.

4. **Set your environment variables.** Copy `.env.example` to `.env.local`
   and fill in your project's URL + anon key (Project Settings → API):

   ```sh
   cp .env.example .env.local
   ```

5. **Bootstrap yourself as admin.** Sign up once through the app (so your
   `profiles` row exists), then in the SQL editor:

   ```sql
   update public.profiles set is_admin = true where id = '<your-auth-user-uuid>';
   ```

   (Find your UUID in Authentication → Users.)

6. **Run the dev server**

   ```sh
   npm run dev
   ```

## Environment variables

See [.env.example](.env.example) for the full list and where each value comes
from. `VITE_`-prefixed variables are bundled into the frontend (safe to be
public — the anon key is meant to be used from browsers and is constrained by
RLS). The `FOOTBALL_DATA_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
**server-side only** secrets used by the sync Edge Function — set them with
`supabase secrets set`, never in frontend code or `VITE_` variables.

## Database schema

See `supabase/migrations/` for the full, commented SQL:

- `..._initial_schema.sql` — tables (`profiles`, `matches`, `standings`,
  `bets`, `tournament_bets`, `tournament_config`) and the trigger that creates
  a profile on sign-up.
- `..._scoring_functions.sql` — pure scoring functions plus triggers that
  recompute points whenever official results land (sync job or admin fix).
- `..._rls_policies.sql` — Row Level Security: the server-side enforcement of
  bet locking (`kickoff_at` / `tournament_config.lock_at`) and of "you can
  only see others' picks once they've locked".
- `..._seed_tournament_config.sql` — seeds the singleton tournament config row
  (lock time + configurable scoring constants for podium/top-scorer picks).

## Scoring rules

| Bet type | Rule | Points |
|---|---|---|
| Match score | Exact score correct | 3 |
| Match score | Correct outcome (win/draw/loss), wrong score | 1 |
| Match score | Otherwise | 0 |
| Tournament podium | Country picked in its exact podium position | `tournament_config.points_podium_correct_position` (default 5), per position |
| Tournament top scorer | Correct player picked | `tournament_config.points_top_scorer` (default 3) |

Match-bet values are fixed by the rules of the game and live in
`calculate_match_points`. Tournament-bet values are intentionally
configurable at runtime via the `tournament_config` table (no redeploy
needed) — change them with a simple `update`.
