-- KAL-731: cut the database's own disk writes (Supabase Disk IO budget warning).
--
-- Measured on production, 2026-11-17 (counters since the Oct 17 restart):
--
-- 1. Scratch files were the biggest steady writer. About once a minute,
--    something outside the app (Supabase's own monitoring reads query stats)
--    read pg_stat_statements. It had grown to 4,932 entries and 2.3 MB of
--    query text, which no longer fits in work_mem (2 MB), so every read wrote
--    and re-read a ~4 MB scratch file: 26,701 files, 59 GB since Oct 17.
--    Resetting the stats once a week keeps the table small enough to stay in
--    memory. The Query Performance page then shows up to a week of history.
--
-- 2. pg_cron keeps a row per run in cron.job_run_details and never clears it.
--    The one-minute sheet sync sweep adds 1,440 rows a day: 26,554 rows back
--    to Aug 12, 41 MB. Keep 3 days. These are run logs, not customer data.

do $outer$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'kal731-trim-cron-history') then
    perform cron.unschedule('kal731-trim-cron-history');
  end if;
  perform cron.schedule(
    'kal731-trim-cron-history',
    '35 3 * * *',
    $cmd$delete from cron.job_run_details where end_time < now() - interval '3 days'$cmd$
  );

  if exists (select 1 from pg_extension where extname = 'pg_stat_statements') then
    if exists (select 1 from cron.job where jobname = 'kal731-reset-query-stats') then
      perform cron.unschedule('kal731-reset-query-stats');
    end if;
    perform cron.schedule(
      'kal731-reset-query-stats',
      '45 3 * * 0',
      $cmd$select extensions.pg_stat_statements_reset()$cmd$
    );
  end if;

  delete from cron.job_run_details where end_time < now() - interval '3 days';
end
$outer$;
