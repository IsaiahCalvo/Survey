-- Survey agent voice logs: the timeline of a person's last few spoken turns
-- (mic tap, speech start and end, what speech to text heard, model and tool
-- calls, timings), sent from the agent panel with "Send voice log" or on its
-- own when hearing fails (src/agent/voiceLog.js). No audio and no keys: the
-- app scrubs them before sending. Used to debug real walks.
--
-- A person can add and read only their own logs. The team reads them with
-- the service role. Rows older than 30 days are removed by
-- prune_survey_agent_voice_logs() (service only; schedule it with the other
-- daily cleanups).

create table if not exists public.survey_agent_voice_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  reason text not null default 'manual' check (reason in ('manual', 'error')),
  release text check (release is null or length(release) <= 64),
  platform text check (platform is null or length(platform) <= 240),
  log jsonb not null check (pg_column_size(log) <= 200000)
);

create index if not exists survey_agent_voice_logs_user_created_idx
  on public.survey_agent_voice_logs (user_id, created_at desc);

alter table public.survey_agent_voice_logs enable row level security;
revoke all on table public.survey_agent_voice_logs from anon;
grant select, insert on table public.survey_agent_voice_logs to authenticated;

drop policy if exists "voice logs: insert own" on public.survey_agent_voice_logs;
create policy "voice logs: insert own" on public.survey_agent_voice_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "voice logs: read own" on public.survey_agent_voice_logs;
create policy "voice logs: read own" on public.survey_agent_voice_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- At most 50 logs a person a day, so a stuck error loop can't fill the table.
create or replace function public.survey_agent_voice_logs_rate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.survey_agent_voice_logs
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 50 then
    raise exception 'voice_log_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists survey_agent_voice_logs_rate on public.survey_agent_voice_logs;
create trigger survey_agent_voice_logs_rate
  before insert on public.survey_agent_voice_logs
  for each row execute function public.survey_agent_voice_logs_rate();

create or replace function public.prune_survey_agent_voice_logs(keep_days integer default 30)
returns integer
language sql
security definer
set search_path = public
as $$
  with gone as (
    delete from public.survey_agent_voice_logs
    where created_at < now() - make_interval(days => greatest(keep_days, 1))
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function public.prune_survey_agent_voice_logs(integer) from public, anon, authenticated;
revoke all on function public.survey_agent_voice_logs_rate() from public, anon, authenticated;
