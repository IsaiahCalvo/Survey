-- What the voice agent would cost per day at the provider's paid prices,
-- next to the request and token counts (survey_agent_daily_usage). On
-- Groq's free tier nothing is billed; this shows what each day would cost
-- once on a paid plan, the same estimate the per-person monthly cost cap
-- uses (survey_agent_usage.cost_micros).
-- record_survey_agent_daily gains p_cost_micros (default 0), so a caller
-- still sending three arguments keeps working while a deploy rolls out.

alter table public.survey_agent_daily_usage
  add column if not exists cost_micros bigint not null default 0;

drop function if exists public.record_survey_agent_daily(text, bigint, numeric);

create or replace function public.record_survey_agent_daily(
  p_kind text,
  p_tokens bigint,
  p_audio_seconds numeric,
  p_cost_micros bigint default 0
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.survey_agent_daily_usage as d (day, kind, requests, tokens, audio_seconds, cost_micros)
  values (
    (now() at time zone 'utc')::date, p_kind, 1,
    greatest(coalesce(p_tokens, 0), 0), greatest(coalesce(p_audio_seconds, 0), 0), greatest(coalesce(p_cost_micros, 0), 0)
  )
  on conflict (day, kind) do update set
    requests = d.requests + 1,
    tokens = d.tokens + excluded.tokens,
    audio_seconds = d.audio_seconds + excluded.audio_seconds,
    cost_micros = d.cost_micros + excluded.cost_micros;
$$;

revoke all on function public.record_survey_agent_daily(text, bigint, numeric, bigint) from public, anon, authenticated;
grant execute on function public.record_survey_agent_daily(text, bigint, numeric, bigint) to service_role;
