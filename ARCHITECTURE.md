# Architecture

A Flashscore-style match browser and analytics platform, scoped to WC 2026 but designed to extend to any competition.

---

## Layers

```
┌─────────────────────────────────────────────────────┐
│  UI Pages & Components                              │
│  Calendar · MatchDetail · TeamPage · Schedule       │
│  Bracket · Stats · MatchAnalysis · …               │
└───────────────────┬─────────────────────────────────┘
                    │ domain types only
┌───────────────────▼─────────────────────────────────┐
│  DataProvider interface  (src/lib/providers/)        │
│  getFixturesByDate · getMatch · getTeam · getStandings │
└─────────┬───────────────────┬───────────────────────┘
          │                   │ (future adapter seam)
┌─────────▼─────────┐  ┌─────▼──────────────────┐
│  SupabaseAdapter  │  │  APIFootballAdapter     │
│  (primary)        │  │  (drop-in when needed)  │
│  reads from DB    │  │  implements same iface  │
└─────────┬─────────┘  └────────────────────────┘
          │
┌─────────▼─────────────────────────────────────────┐
│  Supabase DB  (Postgres + RLS + Realtime)         │
│  matches · standings · scorers · bets · reactions  │
│  predictions · shots · match_events                │
│  match_events_live · match_stats                   │
└─────────┬─────────────────────────────────────────┘
          │                    ▲
          │ served by          │ populated by
          │                    │
┌─────────▼─────────────────────────────────────────┐
│  Edge Functions  (Supabase / Deno)                │
│  auto-sync-fixtures  → football-data.org           │
│  sync-live-events    → API-Football                │
│  ingest-statsbomb    → StatsBomb GitHub CDN        │
│  compute-predictions → internal Poisson model      │
└───────────────────────────────────────────────────┘
```

---

## Provider abstraction

**Why:** External football APIs have incompatible response shapes and different rate limits / tier access. The provider layer means every page is insulated from upstream changes — swap adapters without touching UI code.

**Interface** — `src/lib/providers/DataProvider.ts`:
```typescript
interface DataProvider {
  getFixturesByDate(date: string, competitionId?: string): Promise<Match[]>
  getMatch(matchId: string): Promise<MatchDetail | null>
  getTeam(teamSlug: string): Promise<TeamDetail | null>
  getStandings(competitionId?: string): Promise<StandingsGroup[]>
}
```

**Domain types** — `src/lib/providers/types.ts`: `Match`, `MatchDetail`, `Team`, `Player`, `MatchEvent`, `MatchStats`, `TeamDetail`, `FormWindow`, `StandingRow`, `StandingsGroup`. These are the only types UI code ever imports for data.

**Current adapter** — `SupabaseAdapter` reads from the Supabase DB (pre-populated by ingestion edge functions). It translates DB row types → domain types. All field normalization, status mapping, and slug generation lives inside the adapter.

**Singleton** — `src/lib/providers/index.ts` exports `provider: DataProvider`. Swap the implementation there; no other file changes.

**DB schema types** — `src/types/database.ts` (hand-written to match the live schema) remain separate from domain types. Adapters may import DB types; UI may not.

---

## Adding a second adapter

1. Create `src/lib/providers/MyNewAdapter.ts` implementing `DataProvider`.
2. Translate the upstream API response → domain types inside the adapter.
3. Change `src/lib/providers/index.ts`: `export const provider: DataProvider = new MyNewAdapter()`
4. Add the new source to `SOURCES.md`.

No routing, component, or hook changes are needed.

---

## Ingestion pipeline

All external data fetches happen in Supabase Edge Functions on a schedule. The frontend **never calls external APIs directly** — only the DB.

| Edge function | Source | Schedule | Tables written |
|---|---|---|---|
| `auto-sync-fixtures` | football-data.org | every 1 min (smart-skip) | `matches`, `standings`, `scorers` |
| `sync-live-events` | API-Football | every 2 min (smart-skip + 8-min throttle) | `match_events_live`, `match_stats` |
| `ingest-statsbomb` | StatsBomb GitHub CDN | manual (admin-triggered, paginated) | `shots`, `match_events` |
| `compute-predictions` | internal model | manual | `predictions` |
| `sync-fixtures` | football-data.org | manual trigger | `matches`, `standings`, `scorers` |
| `send-auth-email` | Supabase Auth | on auth events | — |

Rate-limiting lives inside each edge function (smart-skip, per-match throttle, polite delay). See `SOURCES.md` for limits.

---

## Prediction model

**Algorithm:** Poisson regression with Dixon-Coles low-score correction.

**Strength estimation:** Team attack/defense ratings from WC 2026 finished matches; Bayesian shrinkage toward historical WC average (1.28 goals/team/game, WC 2018+2022). Shrinkage weight = `games / (games + 5)`.

**Calibration:** Once ≥ 20 knockout predictions are resolved, temperature scaling is applied automatically. Temperature `T` is fitted by gradient descent on negative log-likelihood of resolved outcomes. `P_calibrated[i] = P[i]^(1/T) / Σ P[j]^(1/T)`. T < 1 = sharpen (model underconfident). T > 1 = flatten. Before 20 resolved predictions, T = 1.0 (raw Poisson probabilities).

**Audit trail:** Every prediction stored in `predictions` with `computed_at`. Resolved predictions get `actual_outcome`, `brier_score`, `log_loss`, `resolved_at`. The Bracket page shows a reliability diagram and running calibration metrics.

**Limitations:** Poisson independence assumption ignores correlation between goals. Dixon-Coles corrects only the 4 lowest-scoring cells. Full Skellam distribution would be more accurate; possible future upgrade.

---

## Rolling form metrics

Computed client-side in `SupabaseAdapter.getTeam()` from the `matches` table. Last 5 and last 10 finished matches per team:

- **Mean** and **median** goals for/against (median is robust to outlier scorelines).
- **W/D/L** counts.
- **Form rating**: `(W×3 + D×1) / (n×3)` — 0 to 1, equal-weighted.
- **Sample-size label**: shown when `sampleSize < windowSize` so users know metrics are thin early in the tournament.

The model applies Bayesian shrinkage independently — the UI metrics and model priors are consistent.

---

## Analytics layer

| Layer | Where | Source |
|---|---|---|
| Group standings table | `Standings` page | football-data.org (SupabaseAdapter) |
| Top scorers | `Scorers` page | football-data.org |
| Knockout bracket + model probabilities | `Bracket` page | `predictions` table |
| Reliability diagram + Brier / log-loss | `Bracket` page | `predictions` table |
| Rolling form (last 5/10) + sparklines | `TeamPage`, `MatchDetail` | `matches` table (SupabaseAdapter) |
| H2H form comparison | `MatchDetail` pre-match panel | `matches` table (SupabaseAdapter) |
| Live event timeline (goals/cards/subs) | `MatchDetail`, `MatchCard` | `match_events_live` (API-Football) |
| Live match stats (possession, shots, …) | `MatchDetail`, `MatchCard` | `match_stats` (API-Football) |
| Shot maps + xG | `MatchAnalysis`, `Stats` | `shots` (StatsBomb WC 2022) |
| Passing networks | `MatchAnalysis`, `Stats` | `match_events` (StatsBomb WC 2022) |

**Stub seam for richer data:** `MatchDetail` shows "Lineups not available on current data tier" and the passing-network / shot-map sections link to `MatchAnalysis` (StatsBomb) where historical data exists. When a paid provider is connected, the adapter can return `homeLineup`/`awayLineup` on `MatchDetail` and the lineup section auto-activates.

---

## Page inventory

| Route | Purpose | Key components |
|---|---|---|
| `/calendar` | Date browser — **primary navigation** | `MatchRow`, `DayNav` |
| `/match/:id` | Full match view | `EventTimeline`, `StatsPanel`, `FormPanel`, `ProbabilityBar` |
| `/team/:slug` | Team form, fixtures, results | `FormCard`, `FormSparkline`, `FormBadges` |
| `/` | Prediction game — place/view bets | `MatchCard`, `MatchPreview` |
| `/bracket` | Knockout bracket + model | `ProbabilityBar` (local `ProbBar`) |
| `/analysis` | StatsBomb deep-dive | `ShotMap`, `PassingNetworkViz` |
| `/stats` | Tournament-wide analytics | various SVG charts |
| `/standings` | Group tables | standing rows |
| `/leaderboard` | Points leaderboard | |
| `/admin` | Sync triggers, manual overrides | |

---

## Existing code not yet migrated to the provider layer

`Schedule.tsx`, `Standings.tsx`, `Leaderboard.tsx`, `Stats.tsx`, `Bracket.tsx`, and `MatchAnalysis.tsx` still call `supabase.from(...)` directly. These work correctly; the provider migration is incremental and can happen page-by-page in future PRs. When migrating: import `provider`, replace direct Supabase calls with adapter methods, keep existing DB types only inside adapters.

---

## Key invariants

1. **UI never imports DB row types** from `src/types/database.ts`. Only domain types from `src/lib/providers/types.ts`.
2. **Adapters are the translation boundary.** All status mapping, slug generation, and null handling happens inside the adapter, not in components.
3. **The DB is the cache.** The frontend never calls external football APIs. Edge functions own all external I/O.
4. **Feature flags for data gaps.** Missing fields render as "not available on current tier" rather than errors or crashes.
