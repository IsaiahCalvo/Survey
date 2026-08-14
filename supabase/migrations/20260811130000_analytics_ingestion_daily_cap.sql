-- One short transaction protects Agent Native ingestion across all Vercel
-- instances. Browser-side/IP limits remain defense in depth, not authority.
create table if not exists public.analytics_ingestion_daily_counters (
  usage_date date not null,
  scope_key text not null,
  event_count integer not null default 0 check (event_count >= 0),
  primary key (usage_date, scope_key)
);

alter table public.analytics_ingestion_daily_counters enable row level security;
alter table public.analytics_ingestion_daily_counters force row level security;
revoke all on table public.analytics_ingestion_daily_counters from public, anon, authenticated;

create or replace function public.reserve_analytics_ingestion_slot(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_day date := (now() at time zone 'utc')::date;
  global_count integer;
  user_count integer;
begin
  if auth.role() <> 'service_role' or p_user_id is null then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  -- Transaction-scoped lock makes the following read/check/increment atomic
  -- even when many serverless instances reserve concurrently.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('survey-analytics:' || current_day::text));

  -- Retain only the current day plus seven completed UTC days. Cleanup shares
  -- the quota lock, so concurrent serverless calls cannot race the active row.
  delete from public.analytics_ingestion_daily_counters
  where usage_date < current_day - 7;

  insert into public.analytics_ingestion_daily_counters (usage_date, scope_key, event_count)
  values (current_day, 'global', 0), (current_day, 'user:' || p_user_id::text, 0)
  on conflict (usage_date, scope_key) do nothing;

  select event_count into global_count
  from public.analytics_ingestion_daily_counters
  where usage_date = current_day and scope_key = 'global';

  select event_count into user_count
  from public.analytics_ingestion_daily_counters
  where usage_date = current_day and scope_key = 'user:' || p_user_id::text;

  -- Conservative fixed ceilings remain well below the open-source collector's
  -- published 30-day default; one user may consume at most 5% of a Survey day.
  if global_count >= 10000 or user_count >= 500 then
    return false;
  end if;

  update public.analytics_ingestion_daily_counters
  set event_count = event_count + 1
  where usage_date = current_day
    and scope_key in ('global', 'user:' || p_user_id::text);
  return true;
end;
$$;

revoke all on function public.reserve_analytics_ingestion_slot(uuid) from public, anon, authenticated;
grant execute on function public.reserve_analytics_ingestion_slot(uuid) to service_role;
