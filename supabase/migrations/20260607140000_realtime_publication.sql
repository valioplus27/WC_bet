-- ============================================================================
-- Realtime — every page subscribes to postgres_changes (matches, standings,
-- bets, tournament_bets, tournament_config, profiles) so scores, points,
-- and reveals update live for everyone without a refresh. Supabase projects
-- start with an empty `supabase_realtime` publication, so each table that
-- should broadcast changes has to be added explicitly.
--
-- Wrapped in a check against pg_publication_tables so this migration can be
-- (re)run safely even if a table was already added by hand via the dashboard.
-- ============================================================================

do $$
declare
  target text;
begin
  foreach target in array array['matches', 'standings', 'bets', 'tournament_bets', 'tournament_config', 'profiles']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;

-- ============================================================================
-- The sync-fixtures Edge Function upserts standings on (group_name, team_name)
-- — World Cup groups don't change once the tournament starts, so there's
-- never a stale row to remove and upserting keeps the table populated at all
-- times (a delete-then-insert would briefly show an empty table to everyone
-- watching via realtime). Correcting the original comment to match.
-- ============================================================================
comment on table public.standings is 'Group-stage tables, upserted by (group_name, team_name) on each sync from the football-data API.';
