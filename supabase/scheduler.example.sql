-- Run after the publish-worker Edge Function is deployed.
-- The secret remains in the private schema and is injected server-side by Postgres.
select cron.schedule(
  'content-hub-publish-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://ntdqqzqgkylxixivkmrp.supabase.co/functions/v1/publish-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-worker-secret',(select value from private.app_secrets where key='worker_http_secret')
      ),
      body := jsonb_build_object('source','supabase-cron','time',now()),
      timeout_milliseconds := 55000
    );
  $$
);
