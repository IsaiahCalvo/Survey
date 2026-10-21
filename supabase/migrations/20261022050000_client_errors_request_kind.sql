-- Crash reports may now carry kind 'request': Survey's own server answered
-- 5xx, or never answered while the device was online
-- (src/utils/requestErrorLog.js). Same function otherwise; see
-- 20261021141000_client_errors.sql.

create or replace function public.report_client_error(
  p_kind text,
  p_message text,
  p_stack text default null,
  p_route text default null,
  p_build text default null,
  p_platform text default null,
  p_browser text default null,
  p_occurred_at timestamptz default null,
  p_repeats integer default 1,
  p_report_id text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind is null or p_kind not in ('react', 'error', 'rejection', 'freeze', 'closed', 'shell-reload', 'request') then
    return false;
  end if;
  -- Flood guard across all senders: at most 600 reports in any 10 minutes.
  if (select count(*) from public.client_errors where received_at > now() - interval '10 minutes') >= 600 then
    return false;
  end if;
  insert into public.client_errors (occurred_at, kind, message, stack, route, build, platform, browser, repeats, report_id)
  values (
    least(coalesce(p_occurred_at, now()), now()),
    p_kind,
    left(coalesce(nullif(p_message, ''), 'Unknown error'), 300),
    left(p_stack, 1500),
    left(p_route, 120),
    left(p_build, 64),
    left(p_platform, 24),
    left(p_browser, 32),
    greatest(1, least(coalesce(p_repeats, 1), 1000)),
    left(p_report_id, 40)
  )
  on conflict (report_id) do nothing;
  return true;
end;
$$;

revoke all on function public.report_client_error(text, text, text, text, text, text, text, timestamptz, integer, text) from public;
grant execute on function public.report_client_error(text, text, text, text, text, text, text, timestamptz, integer, text) to anon, authenticated;
