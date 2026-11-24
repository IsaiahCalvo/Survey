-- AI credits (owner 2026-11-24): the suite's paid AI runs on the monthly API
-- credits that come with Isaiah's subscriptions, and must never spend past
-- them. One budget per provider for ALL apps on this database (Survey's
-- agent, Walkthru's transcripts and summaries), so two apps can't each spend
-- the whole credit.
--
-- Every paid call first holds its most it could cost (reserve_ai_credit).
-- The hold is refused once the period's spend would pass the cap. After the
-- call, settle_ai_credit swaps the hold for the real cost. A provider with no
-- budget row, or a cap of 0, refuses every paid call (fail closed).
--
-- A period starts on cycle_day each month, so the cap can follow the
-- provider's billing cycle (credits end with the cycle, not the calendar
-- month). Written only by the edge functions and Walkthru's server (service
-- role); nobody else can read or write these tables.

create table if not exists public.ai_credit_budgets (
  provider text primary key check (provider ~ '^[a-z0-9_-]{2,32}$'),
  monthly_cap_micros bigint not null default 0 check (monthly_cap_micros >= 0),
  cycle_day smallint not null default 1 check (cycle_day between 1 and 28),
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_credit_spend (
  provider text not null references public.ai_credit_budgets (provider) on update cascade,
  period_start date not null,
  spent_micros bigint not null default 0,
  held_micros bigint not null default 0,
  calls integer not null default 0,
  refused integer not null default 0,
  spend_by_app jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (provider, period_start)
);

alter table public.ai_credit_budgets enable row level security;
alter table public.ai_credit_spend enable row level security;
revoke all on public.ai_credit_budgets from public, anon, authenticated;
revoke all on public.ai_credit_spend from public, anon, authenticated;
grant select, insert, update on public.ai_credit_budgets to service_role;
grant select, insert, update on public.ai_credit_spend to service_role;

-- The start of the budget period that holds p_at.
create or replace function public.ai_credit_period_start(p_cycle_day smallint, p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when extract(day from (p_at at time zone 'UTC'))::int >= p_cycle_day
      then make_date(extract(year from (p_at at time zone 'UTC'))::int, extract(month from (p_at at time zone 'UTC'))::int, p_cycle_day)
    else (make_date(extract(year from (p_at at time zone 'UTC'))::int, extract(month from (p_at at time zone 'UTC'))::int, p_cycle_day) - interval '1 month')::date
  end;
$$;

-- Hold p_micros against the provider's cap. True when the call may go ahead.
create or replace function public.reserve_ai_credit(
  p_provider text,
  p_micros bigint,
  p_app text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.ai_credit_budgets;
  period date;
  hold bigint := greatest(coalesce(p_micros, 0), 1);
  ok boolean;
begin
  select * into b from public.ai_credit_budgets where provider = p_provider for update;
  if not found or b.monthly_cap_micros < 1 then
    return false;
  end if;
  period := public.ai_credit_period_start(b.cycle_day);
  insert into public.ai_credit_spend (provider, period_start)
  values (p_provider, period)
  on conflict (provider, period_start) do nothing;

  update public.ai_credit_spend s set
    held_micros = s.held_micros + hold,
    calls = s.calls + 1,
    updated_at = now()
  where s.provider = p_provider and s.period_start = period
    and s.spent_micros + s.held_micros + hold <= b.monthly_cap_micros;
  ok := found;

  if not ok then
    update public.ai_credit_spend s set refused = s.refused + 1, updated_at = now()
    where s.provider = p_provider and s.period_start = period;
  end if;
  return ok;
end;
$$;

-- Swap a hold for the real cost (0 when the call failed). Settles into the
-- period the hold was taken in, even across a period boundary.
create or replace function public.settle_ai_credit(
  p_provider text,
  p_held_micros bigint,
  p_actual_micros bigint,
  p_app text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.ai_credit_budgets;
  period date;
  hold bigint := greatest(coalesce(p_held_micros, 0), 1);
  actual bigint := greatest(coalesce(p_actual_micros, 0), 0);
  app text := coalesce(nullif(p_app, ''), 'unknown');
  spent bigint;
begin
  select * into b from public.ai_credit_budgets where provider = p_provider;
  if not found then
    return 0;
  end if;
  period := public.ai_credit_period_start(b.cycle_day);
  -- The newest period with a hold this size open, so a call that crosses the
  -- boundary still clears its own hold.
  select s.period_start into period from public.ai_credit_spend s
  where s.provider = p_provider and s.held_micros >= hold
  order by s.period_start desc limit 1;
  if not found then
    period := public.ai_credit_period_start(b.cycle_day);
  end if;
  update public.ai_credit_spend s set
    held_micros = greatest(s.held_micros - hold, 0),
    spent_micros = s.spent_micros + actual,
    spend_by_app = jsonb_set(s.spend_by_app, array[app],
      to_jsonb(coalesce((s.spend_by_app ->> app)::bigint, 0) + actual)),
    updated_at = now()
  where s.provider = p_provider and s.period_start = period
  returning s.spent_micros into spent;
  return coalesce(spent, 0);
end;
$$;

revoke all on function public.ai_credit_period_start(smallint, timestamptz) from public, anon, authenticated;
revoke all on function public.reserve_ai_credit(text, bigint, text) from public, anon, authenticated;
revoke all on function public.settle_ai_credit(text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.ai_credit_period_start(smallint, timestamptz) to service_role;
grant execute on function public.reserve_ai_credit(text, bigint, text) to service_role;
grant execute on function public.settle_ai_credit(text, bigint, bigint, text) to service_role;

-- OpenAI: $200 a month of API credits with ChatGPT Pro (email 2026-11-17).
-- Anthropic: 0 until a plan with monthly API credits is linked; then set the
-- cap to that plan's amount (Max $100, Ultra $200, Team up to $500).
-- An existing row is never overwritten, so a cap changed by hand stays.
insert into public.ai_credit_budgets (provider, monthly_cap_micros, note) values
  ('openai', 200000000, 'ChatGPT Pro monthly API credits ($200). Also set the OpenAI org hard spend limit to $200 and keep no card on file.'),
  ('anthropic', 0, 'Claude monthly API credits: set to the plan amount once linked.')
on conflict (provider) do nothing;
