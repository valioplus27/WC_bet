# Data Sources

All data ingested by this application, their licenses, refresh cadences, and limitations.

---

## 1. football-data.org (primary fixture/results/standings source)

| Field | Detail |
|-------|--------|
| **URL** | https://www.football-data.org |
| **License** | Free tier — non-commercial, attribution required; see their [Terms of Service](https://www.football-data.org/docs/v4/index.html#_terms_of_use) |
| **API version** | v4 |
| **Auth** | `X-Auth-Token` header (env var `FOOTBALL_DATA_API_KEY`) |
| **Rate limits** | Free tier: 10 req/min; paid tiers higher |
| **Refresh cadence** | Every minute via pg_cron (`auto-sync-fixtures`); smart-skip when no match is live or starting within 90 min |
| **Tables populated** | `matches`, `standings`, `scorers` |
| **Limitations** | Free tier excludes lineups, detailed match stats (xG, shots, events), and head-to-head from other competitions. No historical data beyond the current competition. |

**What we fetch:**
- `GET /competitions/{code}/matches` — fixture list, scores, statuses, stages
- `GET /competitions/{code}/standings` — group-stage tables
- `GET /competitions/{code}/scorers` — top scorers

---

## 2. StatsBomb Open Data (event/shot data for historical WC)

| Field | Detail |
|-------|--------|
| **URL** | https://github.com/statsbomb/open-data |
| **License** | [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/) — **non-commercial use only; attribution required** |
| **Auth** | None (public GitHub raw content) |
| **Rate limits** | GitHub CDN; polite 150 ms delay between requests in `ingest-statsbomb` |
| **Refresh cadence** | One-time historical load; StatsBomb publishes new competitions periodically but does NOT provide live match data |
| **Tables populated** | `shots`, `match_events` |
| **Competitions available** | FIFA World Cup 2022 (competition\_id=43, season\_id=106); see [open-data/data/competitions.json](https://github.com/statsbomb/open-data/blob/master/data/competitions.json) for the full list |
| **Limitations** | Historical data only — live 2026 WC event data is **not** available on this free tier. WC 2026 shots/xG/passing-network views require a paid StatsBomb API subscription or an equivalent commercial data provider. |

**What we fetch:**
- `data/competitions.json` — available competition/season IDs
- `data/matches/{competition_id}/{season_id}.json` — match metadata
- `data/events/{match_id}.json` — all in-match events (passes, shots, carries, etc.)

**Coordinate system:** StatsBomb pitch coordinates — origin at bottom-left of the pitch, x-axis 0–120 (long), y-axis 0–80 (short). The ShotMap component renders the attacking half (x = 60–120).

**Attribution notice (required by CC BY-SA 4.0):**
> Data provided by StatsBomb Services Ltd. and published under Creative Commons Attribution-NonCommercial-ShareAlike 4.0. See https://github.com/statsbomb/open-data for full terms.

---

## 3. API-Football (live match events and statistics)

| Field | Detail |
|-------|--------|
| **URL** | https://v3.football.api-sports.io |
| **License** | Commercial — free tier included; see [pricing](https://www.api-football.com/pricing) |
| **Auth** | `x-apisports-key` header (Supabase secret `APIFOOTBALL_API_KEY`) |
| **Rate limits** | Free tier: 100 API calls/day. Smart-skip means 0 calls when no match is live. Per-match throttle (8 min) keeps worst-case days under 100. |
| **Refresh cadence** | pg_cron every 2 min (`sync-live-events`); per-match refresh only if data is >8 min old |
| **Tables populated** | `match_events_live` (goal scorers, cards, subs), `match_stats` (possession, shots, corners, fouls) |
| **Limitations** | Free tier may have up to 15-minute data delay. No lineups on free tier. apifootball_id resolution requires one call on first encounter of each match — lazily cached in `matches.apifootball_id`. |
| **Free vs paid** | Free (100/day) covers a normal match day. Basic ~€12/month has 7,500 calls/day and faster updates if you need sub-minute refresh. |

**What we fetch:**
- `GET /fixtures?league=1&season=2026` — one-time fixture list to resolve our football-data.org match IDs → API-Football fixture IDs
- `GET /fixtures/events?fixture={id}` — in-match events (goals, cards, substitutions, VAR)
- `GET /fixtures/statistics?fixture={id}` — possession %, shots, on target, corners, fouls, offsides, yellow/red cards

**Setup:** add your API key with:
```
supabase secrets set APIFOOTBALL_API_KEY=<your-key-from-api-football.com>
```

---

## 4. Internal prediction model (no external source)

| Field | Detail |
|-------|--------|
| **Model** | Poisson regression with Dixon-Coles low-score correction |
| **Parameters** | Team attack/defense strengths estimated from WC 2026 group-stage results in `matches` table; Bayesian shrinkage toward historical WC average (1.28 goals/team/game) |
| **Calibration** | Uncalibrated in v1; Brier score and log-loss tracked per prediction in `predictions` table. Platt scaling or isotonic regression can be applied offline once ≥20 knockout matches have resolved |
| **Refresh cadence** | On-demand via Admin → Run predictions; should be re-run after each round of group-stage or knockout matches completes |
| **Tables populated** | `predictions` |
| **Limitations** | Model quality improves as more WC 2026 results accumulate. Early-tournament predictions are heavily shrunk toward the prior. The model predicts 90-minute results; knockout matches that go to extra time / penalties are recorded by football-data.org as a decisive scoreline |

---

## Adapter architecture

All ingestion functions implement the same internal schema contract:

```
matches            ← football-data.org adapter  (auto-sync-fixtures / sync-fixtures)
standings          ← football-data.org adapter
scorers            ← football-data.org adapter
shots              ← StatsBomb adapter           (ingest-statsbomb)
match_events       ← StatsBomb adapter
predictions        ← internal Poisson model     (compute-predictions)
match_events_live  ← API-Football adapter        (sync-live-events)
match_stats        ← API-Football adapter        (sync-live-events)
```

Each source adapter is a self-contained Supabase Edge Function with:
- Its own external ID scheme (`ext_id` for football-data, `sb_{comp_id}_{match_id}` for StatsBomb)
- Idempotent upserts (safe to re-run)
- Source tag (`source` column) on all event tables so queries can filter by origin
- Rate-limit handling and polite delays

To add a new source, deploy a new Edge Function that writes to the same tables using the same column contracts; no downstream UI code needs to change.
