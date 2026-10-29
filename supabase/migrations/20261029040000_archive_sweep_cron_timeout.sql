-- The daily archive-purge-sweep cron call gave up after pg_net's default 5 s,
-- while the sweep takes about 7 s now that it also removes R2 copies and sets
-- the R2 bucket's CORS rule (docs/PDF-R2.md). The sweep still finished, but
-- net._http_response recorded a timeout instead of its answer. Give the call
-- a minute.
--
-- The job was scheduled by hand with the cron secret in its command, so this
-- edits the existing command in place rather than restating it (the secret
-- must never be in this public repo). No job (local stacks, CI): nothing to do.
do $$
declare
  j record;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  for j in
    select jobid, command from cron.job
    where jobname = 'archive-purge-sweep'
      and command ilike '%net.http_post%'
      and command not ilike '%timeout_milliseconds%'
  loop
    perform cron.alter_job(
      j.jobid,
      command := regexp_replace(j.command, '(\s)body(\s*):=', '\1timeout_milliseconds := 60000,\1body\2:=', 'i')
    );
  end loop;
end
$$;
