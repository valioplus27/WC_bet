-- ============================================================================
-- Live match data: goal events, cards, subs, and in-match statistics
-- (possession, shots, corners, fouls) fetched from API-Football.
-- ============================================================================

-- Link our matches to API-Football fixture IDs so we can fetch events.
-- Resolved lazily by sync-live-events on first sight of a live/upcoming match.
alter table public.matches add column if not exists apifootball_id integer;
create index if not exists matches_apifootball_id_idx on public.matches (apifootball_id)
  where apifootball_id is not null;

-- match_events_live: goal events, cards, substitutions — per match.
-- The entire set for a match is replaced on every sync (delete + insert),
-- so there is no uniqueness constraint on event fields.
create table public.match_events_live (
  id           bigint generated always as identity primary key,
  match_id     bigint not null references public.matches (id) on delete cascade,
  minute       integer not null,
  extra_minute integer,
  event_type   text not null,   -- 'Goal', 'Card', 'subst', 'Var'
  team         text not null,
  player       text,
  assist       text,
  detail       text,             -- 'Normal Goal', 'Own Goal', 'Penalty', 'Yellow Card', …
  created_at   timestamptz not null default now()
);

comment on table public.match_events_live is 'Goal, card, and substitution events from API-Football, refreshed every 2 min during live matches.';

create index match_events_live_match_idx on public.match_events_live (match_id);

alter table public.match_events_live enable row level security;
create policy "events readable by authenticated" on public.match_events_live
  for select to authenticated using (true);

alter publication supabase_realtime add table public.match_events_live;

-- match_stats: one row per match — in-match statistics.
-- Upserted on every live sync; the primary key is match_id (one row per match).
create table public.match_stats (
  match_id               bigint primary key references public.matches (id) on delete cascade,
  home_possession        integer,   -- %
  away_possession        integer,
  home_shots             integer,
  away_shots             integer,
  home_shots_on_target   integer,
  away_shots_on_target   integer,
  home_corners           integer,
  away_corners           integer,
  home_fouls             integer,
  away_fouls             integer,
  home_yellow_cards      integer,
  away_yellow_cards      integer,
  home_red_cards         integer,
  away_red_cards         integer,
  home_offsides          integer,
  away_offsides          integer,
  updated_at             timestamptz not null default now()
);

comment on table public.match_stats is 'In-match statistics (possession, shots, corners, …) from API-Football.';

alter table public.match_stats enable row level security;
create policy "stats readable by authenticated" on public.match_stats
  for select to authenticated using (true);

alter publication supabase_realtime add table public.match_stats;

-- Schedule the live-events sync every 2 minutes.
-- The function smart-skips when no match is IN_PLAY or starting within 30 min,
-- so this cron costs ≈ 0 API-Football calls on idle days.
select cron.unschedule('sync-live-events')
  where exists (select 1 from cron.job where jobname = 'sync-live-events');

select cron.schedule(
  'sync-live-events',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://lqmsrtwhocriwfslfctj.supabase.co/functions/v1/sync-live-events',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
