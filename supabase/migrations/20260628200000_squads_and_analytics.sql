-- ============================================================================
-- Squads, players, coaches, and pre-computed team analytics.
-- ============================================================================

-- teams: one row per WC 2026 team with coaching staff info.
create table public.teams (
  id              text    primary key,  -- slug (e.g. "france")
  name            text    not null,
  short_name      text,
  tla             text,                 -- three-letter abbreviation (e.g. "FRA")
  coach_name      text,
  coach_nationality text,
  crest_url       text,
  fd_id           integer unique,       -- football-data.org numeric team id
  updated_at      timestamptz not null default now()
);

comment on table public.teams is 'WC 2026 team metadata including head coach, synced from football-data.org.';

alter table public.teams enable row level security;
create policy "teams readable by authenticated" on public.teams
  for select to authenticated using (true);
create policy "teams writable by service role" on public.teams
  for all using (auth.role() = 'service_role');

-- players: squad members for each team.
create table public.players (
  id              bigint generated always as identity primary key,
  team_id         text    not null references public.teams (id) on delete cascade,
  fd_id           integer,              -- football-data.org numeric player id
  name            text    not null,
  position        text,                 -- Goalkeeper, Defender, Midfielder, Offence
  shirt_number    integer,
  date_of_birth   date,
  nationality     text,
  updated_at      timestamptz not null default now(),
  unique (team_id, fd_id)
);

comment on table public.players is 'Squad lists for WC 2026 teams, synced from football-data.org.';

create index players_team_idx on public.players (team_id);

alter table public.players enable row level security;
create policy "players readable by authenticated" on public.players
  for select to authenticated using (true);
create policy "players writable by service role" on public.players
  for all using (auth.role() = 'service_role');

-- team_analytics: pre-computed tactical metrics from StatsBomb WC 2022 data.
-- One row per team (WC 2022 names), updated by the compute-team-analytics function.
create table public.team_analytics (
  team_name             text    primary key,
  source                text    not null default 'statsbomb_wc2022',
  -- Passing
  avg_passes_per_match  numeric(7,2),
  pass_completion_rate  numeric(5,4),
  avg_progressive_passes numeric(6,2),
  -- Pressing
  avg_pressures_per_match numeric(6,2),
  press_success_rate    numeric(5,4),
  -- Build-up
  avg_carries_per_match numeric(6,2),
  -- Attacking
  avg_shots_per_match   numeric(5,2),
  avg_xg_per_match      numeric(5,4),
  avg_xg_per_shot       numeric(5,4),
  -- Defending
  avg_tackles_per_match numeric(5,2),
  avg_interceptions_per_match numeric(5,2),
  -- Passing network
  network_centralization numeric(5,4),  -- 0 = perfectly distributed, 1 = star
  avg_chain_length      numeric(5,2),
  -- Fun indices
  chaos_index           numeric(5,4),   -- variance in xG across matches (normalised)
  possession_volatility numeric(5,4),   -- std dev in possession %
  matches_in_sample     integer not null default 0,
  updated_at            timestamptz not null default now()
);

comment on table public.team_analytics is 'Pre-computed per-team tactical metrics from StatsBomb WC 2022 event data.';

alter table public.team_analytics enable row level security;
create policy "team_analytics readable by authenticated" on public.team_analytics
  for select to authenticated using (true);
create policy "team_analytics writable by service role" on public.team_analytics
  for all using (auth.role() = 'service_role');
