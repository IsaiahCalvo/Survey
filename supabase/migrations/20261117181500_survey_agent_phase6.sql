-- Survey agent phase 6 (KAL-532). Adds only.
--
-- 1. Photo questions: the edge function's 'look' action counts in the daily
--    totals as its own kind.
-- 2. Nightly flag agent-photo-questions.
-- 3. Learning loop: per day and prompt version, how many agent turns changed
--    something and how many of those the person took back (Undo, or "no,
--    that was D-118"). Counted only for people who turned on "Help improve
--    Survey" (user_metadata.improve_survey_opt_in), checked by the edge
--    function. No personal data: counts per day, prompt version and event.
-- 4. Staff (feature flag admins) read this month's agent use per account and
--    the undo rate per prompt version on /flags.

alter table public.survey_agent_daily_usage
  drop constraint if exists survey_agent_daily_usage_kind_check;
alter table public.survey_agent_daily_usage
  add constraint survey_agent_daily_usage_kind_check check (kind in ('turn', 'transcribe', 'speak', 'look'));

insert into public.feature_flags (key, mode, description) values
  ('agent-photo-questions', 'off', 'Survey agent answers questions about a photo on an item, or one added in the chat.')
on conflict (key) do nothing;

create table if not exists public.survey_agent_feedback_daily (
  day date not null,
  prompt_version text not null check (prompt_version ~ '^[a-z0-9-]{1,32}$'),
  event text not null check (event in ('changed', 'undo', 'voice_undo')),
  count integer not null default 0,
  primary key (day, prompt_version, event)
);

alter table public.survey_agent_feedback_daily enable row level security;
revoke all on public.survey_agent_feedback_daily from public, anon, authenticated;

create or replace function public.record_survey_agent_feedback(
  p_prompt_version text,
  p_event text
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.survey_agent_feedback_daily as f (day, prompt_version, event, count)
  values ((now() at time zone 'utc')::date, p_prompt_version, p_event, 1)
  on conflict (day, prompt_version, event) do update set count = f.count + 1;
$$;

revoke all on function public.record_survey_agent_feedback(text, text) from public, anon, authenticated;
grant execute on function public.record_survey_agent_feedback(text, text) to service_role;

-- This month's agent use per account, for staff. Empty for anyone else.
create or replace function public.staff_survey_agent_usage()
returns table (email text, requests integer, cost_micros bigint, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text, s.requests, s.cost_micros, s.updated_at
    from public.survey_agent_usage s
    join auth.users u on u.id = s.user_id
   where public.is_feature_flag_admin()
     and s.month = date_trunc('month', now() at time zone 'utc')::date
   order by s.cost_micros desc, s.requests desc
   limit 200;
$$;

revoke all on function public.staff_survey_agent_usage() from public, anon;
grant execute on function public.staff_survey_agent_usage() to authenticated;

-- Turns that changed something, and how many were taken back, per prompt
-- version over the last 30 days. Empty for anyone but staff.
create or replace function public.staff_survey_agent_feedback()
returns table (prompt_version text, changed bigint, undone bigint, first_day date, last_day date)
language sql
stable
security definer
set search_path = ''
as $$
  select f.prompt_version,
         coalesce(sum(f.count) filter (where f.event = 'changed'), 0),
         coalesce(sum(f.count) filter (where f.event in ('undo', 'voice_undo')), 0),
         min(f.day), max(f.day)
    from public.survey_agent_feedback_daily f
   where public.is_feature_flag_admin()
     and f.day >= (now() at time zone 'utc')::date - 30
   group by f.prompt_version
   order by max(f.day) desc;
$$;

revoke all on function public.staff_survey_agent_feedback() from public, anon;
grant execute on function public.staff_survey_agent_feedback() to authenticated;
