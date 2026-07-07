-- ============================================
-- DeadlineTracker — Cron Job Setup
-- Run this in the Supabase SQL Editor AFTER:
-- 1. Enabling pg_cron and pg_net extensions
-- 2. Deploying the send-reminders Edge Function
-- ============================================

-- Schedule daily at 9 AM UTC
-- This dynamically retrieves the service_role_key from the Supabase Vault
-- and invokes the Edge Function via the internal Kong API gateway.
SELECT cron.schedule(
  'send-deadline-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'http://kong:8000/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        'YOUR_SERVICE_ROLE_KEY'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To unschedule:
-- SELECT cron.unschedule('send-deadline-reminders');

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To view job run history:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
