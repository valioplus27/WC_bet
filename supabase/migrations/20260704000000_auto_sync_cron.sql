-- ============================================================================
-- Auto-sync pg_cron jobs — removes the need to press sync buttons in Admin.
--
-- Prerequisites: pg_cron and pg_net extensions must be enabled in the project.
-- Enable via: Dashboard → Database → Extensions → pg_cron + pg_net
--
-- Existing cron jobs (already set up):
--   auto-sync-fixtures  : every 1 min  → pulls fixtures/standings/scorers
--   sync-live-events    : every 2 min  → live events & stats (smart-skip)
--
-- New jobs added here:
--   compute-predictions : every hour   → runs Poisson model on finished results
--   sync-squads-daily   : daily 03:00  → pulls squad + coach data
--   team-analytics-daily: daily 04:00  → mines StatsBomb WC2022 data
-- ============================================================================

-- Remove any old manual cron entries with the same names (idempotent)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('compute-predictions-hourly', 'sync-squads-daily', 'compute-team-analytics-daily')
;

-- compute-predictions every hour (runs fast, only touches predictions table)
SELECT cron.schedule(
  'compute-predictions-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lqmsrtwhocriwfslfctj.supabase.co/functions/v1/compute-predictions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- sync-squads once a day at 03:00 UTC (squads change rarely)
SELECT cron.schedule(
  'sync-squads-daily',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lqmsrtwhocriwfslfctj.supabase.co/functions/v1/sync-squads',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- compute-team-analytics once a day at 04:00 UTC (StatsBomb data is static;
-- re-running is cheap and keeps analytics fresh if ingestion ever adds more data)
SELECT cron.schedule(
  'compute-team-analytics-daily',
  '0 4 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://lqmsrtwhocriwfslfctj.supabase.co/functions/v1/compute-team-analytics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
    ),
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
