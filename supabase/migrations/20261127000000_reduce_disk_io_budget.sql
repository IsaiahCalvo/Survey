-- Disk IO budget reduction (2026-11-27).
--
-- Based on live Postgres stats on production:
--
-- 1. `sheet-sync-sweep` pg_cron job (20261030030000_sheet_sync_background_sweep.sql)
--    ran every minute (`* * * * *`, 1,440x/day) even for a single active link,
--    accumulating 34k+ rows in `cron.job_run_details` and `net.http_request_queue`,
--    6.6k+ direct disk writes to `net._http_response`, and 74k+ / 49k+ seq scans
--    on `sheet_sync_links` and `sheet_sync_connections`. Open clients already
--    drive live sheet rounds directly; moving the background sweep to every
--    5 minutes (`*/5 * * * *`, 288x/day) cuts 24/7 cron + pg_net + sweep IO by 80%.
--
-- 2. Add targeted missing indexes for the two background sweep scan paths:
--    - `sheet_sync_links`: partial index on `(last_round_at asc nulls first) where status = 'active'`
--      covers both the cron `exists (... where status = 'active')` check and
--      `/sweep`'s `where status = 'active' order by last_round_at asc nulls first`.
--    - `sheet_sync_connections`: PK is `(user_id, provider)` (so `user_id` is
--      already indexed), but `keepSignInsAlive` queries `where provider = $1 and updated_at < $2 order by updated_at asc`.
--      Indexing `(provider, updated_at)` eliminates seq scans as connections grow.
--    - Note: `analytics_ingestion_daily_counters` already has PK `(usage_date, scope_key)`
--      and retains only 8 days of rows; Postgres chooses in-RAM seq scans on small
--      tables by design, so no redundant index is added there.
--
-- 3. `annotation_snapshots.snapshot` stores already-gzipped Yjs state
--    (`encoding_version = 2`). Setting `STORAGE EXTERNAL` skips wasted CPU and
--    temp-buffer attempts to re-compress incompressible gzip bytes on every TOAST
--    write, and `fillfactor = 80` leaves headroom for HOT updates on the single
--    per-document row (only `document_id` PK is indexed). Both are metadata-only
--    DDL with no table rewrite.

do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    if exists (select 1 from cron.job where jobname = 'sheet-sync-sweep') then
      perform cron.unschedule('sheet-sync-sweep');
    end if;
    perform cron.schedule(
      'sheet-sync-sweep',
      '*/5 * * * *',
      $cmd$
        select net.http_post(
          url := s.function_url || '/sweep',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-sheet-sync-sweep', s.sweep_secret),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        )
        from public.sheet_sync_settings s
        where s.function_url is not null
          and exists (select 1 from public.sheet_sync_links l where l.status = 'active')
      $cmd$
    );
  end if;
end;
$outer$;

create index if not exists sheet_sync_links_active_last_round_idx
  on public.sheet_sync_links (last_round_at asc nulls first)
  where status = 'active';

create index if not exists sheet_sync_connections_provider_updated_idx
  on public.sheet_sync_connections (provider, updated_at);

alter table public.annotation_snapshots
  alter column snapshot set storage external;

alter table public.annotation_snapshots
  set (fillfactor = 80);
