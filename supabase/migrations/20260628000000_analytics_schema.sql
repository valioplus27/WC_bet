-- ============================================================================
-- Analytics schema: shots (event-level data), match_events (passes, for
-- passing-network computation), and predictions (Poisson model outputs with
-- Brier/log-loss tracking for calibration).
-- ============================================================================

-- shots: ingested from StatsBomb open data or other event sources.
-- x/y use StatsBomb pitch coordinates (origin = bottom-left of pitch,
-- 0-120 along the long axis, 0-80 along the short axis).
create table public.shots (
  id              bigint generated always as identity primary key,
  source          text    not null,
  match_ext_id    text    not null,
  competition_id  integer,
  season_id       integer,
  minute          integer not null,
  period          integer not null default 1,
  team            text    not null,
  player          text    not null,
  x               numeric(5,2) not null,
  y               numeric(5,2) not null,
  xg              numeric(6,4),
  outcome         text    not null,
  body_part       text,
  is_penalty      boolean not null default false,
  created_at      timestamptz not null default now()
);

comment on table public.shots is 'Shot-level event data (StatsBomb open data for WC 2022 historical reference).';
comment on column public.shots.x is 'StatsBomb pitch coordinate, 0-120 along long axis.';
comment on column public.shots.y is 'StatsBomb pitch coordinate, 0-80 along short axis.';

create index shots_source_match_idx on public.shots (source, match_ext_id);
create index shots_team_idx        on public.shots (team);

alter table public.shots enable row level security;
create policy "shots readable by authenticated" on public.shots
  for select to authenticated using (true);

-- match_events: pass events (and other types) used for passing-network graphs.
create table public.match_events (
  id              bigint generated always as identity primary key,
  source          text    not null,
  match_ext_id    text    not null,
  competition_id  integer,
  season_id       integer,
  event_type      text    not null,
  minute          integer not null,
  period          integer not null default 1,
  team            text    not null,
  player          text,
  to_player       text,
  x               numeric(5,2),
  y               numeric(5,2),
  end_x           numeric(5,2),
  end_y           numeric(5,2),
  outcome         text,
  created_at      timestamptz not null default now()
);

comment on table public.match_events is 'Pass and other event data from StatsBomb. Source for passing-network construction.';

create index events_source_match_idx on public.match_events (source, match_ext_id);
create index events_type_team_idx    on public.match_events (event_type, team);

alter table public.match_events enable row level security;
create policy "events readable by authenticated" on public.match_events
  for select to authenticated using (true);

-- predictions: Poisson model outputs per knockout-stage match.
-- home_win_prob + draw_prob + away_win_prob ≈ 1 (tiny rounding drift allowed).
-- brier_score and log_loss are set once actual_outcome is recorded.
-- The unique constraint on (match_id, model_version) makes upsert idempotent.
create table public.predictions (
  id               bigint generated always as identity primary key,
  match_id         bigint not null references public.matches (id) on delete cascade,
  model_version    text   not null default 'poisson-v1',
  home_win_prob    numeric(6,4) not null,
  draw_prob        numeric(6,4) not null,
  away_win_prob    numeric(6,4) not null,
  -- Set once the match finishes:
  actual_outcome   text check (actual_outcome in ('home_win', 'draw', 'away_win')),
  brier_score      numeric(8,6),
  log_loss         numeric(8,6),
  computed_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  unique (match_id, model_version)
);

comment on table public.predictions is 'Per-match win/draw/loss probabilities from the Poisson model. Brier score and log-loss set once actual_outcome is known.';

create index predictions_match_idx    on public.predictions (match_id);
create index predictions_resolved_idx on public.predictions (actual_outcome)
  where actual_outcome is not null;

alter table public.predictions enable row level security;
create policy "predictions readable by authenticated" on public.predictions
  for select to authenticated using (true);

alter publication supabase_realtime add table public.predictions;
