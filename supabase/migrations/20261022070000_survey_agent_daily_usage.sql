-- Daily voice-agent totals per kind of call, for the quota alert
-- (scripts/backend-alerts.mjs). Groq's free tier caps each model per day:
-- the chat model (turn) by requests and tokens, speech-to-text (transcribe)
-- by requests and audio seconds, text-to-speech (speak) by requests and
-- tokens (speak records input characters; about 4 make a token).
-- survey_agent_usage is per person per month, so it can't show a day.
-- No personal data: one row per day and kind, server-only.

create table if not exists public.survey_agent_daily_usage (
  day date not null,
  kind text not null check (kind in ('turn', 'transcribe', 'speak')),
  requests integer not null default 0,
  tokens bigint not null default 0,
  audio_seconds numeric not null default 0,
  primary key (day, kind)
);

alter table public.survey_agent_daily_usage enable row level security;
revoke all on public.survey_agent_daily_usage from public, anon, authenticated;

create or replace function public.record_survey_agent_daily(
  p_kind text,
  p_tokens bigint,
  p_audio_seconds numeric
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.survey_agent_daily_usage as d (day, kind, requests, tokens, audio_seconds)
  values ((now() at time zone 'utc')::date, p_kind, 1, greatest(coalesce(p_tokens, 0), 0), greatest(coalesce(p_audio_seconds, 0), 0))
  on conflict (day, kind) do update set
    requests = d.requests + 1,
    tokens = d.tokens + excluded.tokens,
    audio_seconds = d.audio_seconds + excluded.audio_seconds;
$$;

revoke all on function public.record_survey_agent_daily(text, bigint, numeric) from public, anon, authenticated;
grant execute on function public.record_survey_agent_daily(text, bigint, numeric) to service_role;
