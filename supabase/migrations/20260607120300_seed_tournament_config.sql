-- ============================================================================
-- Seed: tournament_config singleton row.
--
-- `lock_at` below is a placeholder (the 2026 World Cup's scheduled opening
-- day, 11 June 2026, at a nominal UTC time) so the column constraint is
-- satisfied and the app has something sane to show before the first sync.
--
-- IMPORTANT — once fixtures are synced, an admin should set this to the
-- *actual* opening kickoff (or any other cutoff you prefer for tournament
-- bets) via the admin UI, or directly with:
--
--   update public.tournament_config
--   set lock_at = (select min(kickoff_at) from public.matches)
--   where id = 1;
-- ============================================================================
insert into public.tournament_config (id, lock_at)
values (1, '2026-06-11 19:00:00+00')
on conflict (id) do nothing;
