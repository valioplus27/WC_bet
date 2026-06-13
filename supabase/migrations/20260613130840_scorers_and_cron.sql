-- ============================================================================
-- Top scorers table — synced from football-data.org /scorers endpoint
-- ============================================================================
create table public.scorers (
  id                bigint primary key generated always as identity,
  player_ext_id     bigint  not null unique,
  player_name       text    not null,
  team_name         text    not null,
  nationality       text,
  goals             int     not null default 0,
  assists           int     not null default 0,
  penalties         int     not null default 0,
  played_matches    int     not null default 0,
  updated_at        timestamptz not null default now()
);

alter table public.scorers enable row level security;

create policy "authenticated users can read scorers"
  on public.scorers for select to authenticated using (true);

alter publication supabase_realtime add table public.scorers;

-- ============================================================================
-- Auto-sync cron — fires every minute; the edge function itself skips the
-- football-data.org API call when no match is live or starting within 90 min.
-- ============================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of this job so the migration is re-runnable.
select cron.unschedule('auto-sync-fixtures')
  where exists (select 1 from cron.job where jobname = 'auto-sync-fixtures');

select cron.schedule(
  'auto-sync-fixtures',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://lqmsrtwhocriwfslfctj.supabase.co/functions/v1/auto-sync-fixtures',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
