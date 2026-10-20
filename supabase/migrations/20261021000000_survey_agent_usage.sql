-- Survey agent (KAL-527): what each person's agent use cost this month, so
-- the survey-agent edge function can stop at a monthly cap. Written only by
-- the edge function (service role) through record_survey_agent_usage; a
-- person can read their own rows.

create table if not exists public.survey_agent_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  requests integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cost_micros bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.survey_agent_usage enable row level security;

drop policy if exists survey_agent_usage_select_own on public.survey_agent_usage;
create policy survey_agent_usage_select_own on public.survey_agent_usage
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.survey_agent_usage from anon, authenticated;
grant select on public.survey_agent_usage to authenticated;

create or replace function public.record_survey_agent_usage(
  p_user_id uuid,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_micros bigint
) returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.survey_agent_usage (user_id, month, requests, input_tokens, output_tokens, cost_micros)
  values (p_user_id, date_trunc('month', now())::date, 1, greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cost_micros, 0))
  on conflict (user_id, month) do update set
    requests = public.survey_agent_usage.requests + 1,
    input_tokens = public.survey_agent_usage.input_tokens + excluded.input_tokens,
    output_tokens = public.survey_agent_usage.output_tokens + excluded.output_tokens,
    cost_micros = public.survey_agent_usage.cost_micros + excluded.cost_micros,
    updated_at = now()
  returning cost_micros;
$$;

revoke all on function public.record_survey_agent_usage(uuid, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.record_survey_agent_usage(uuid, bigint, bigint, bigint) to service_role;
