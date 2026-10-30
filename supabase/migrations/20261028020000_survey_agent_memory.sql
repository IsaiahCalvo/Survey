-- Survey agent memory (Nightly beta, plan 2026-10-27): what the agent learns
-- in a project, so a fix is said once, not every walk.
--
--   kind 'name'    "Whenever I say D101 I mean D-1-01": heard = 'D101',
--                  means = the item's name (D-1-01). An item can have several.
--   kind 'wording' "Always write not installed, not missing": heard =
--                  'missing', means = 'not installed'. Notes use `means`.
--
-- Keyed by project: everyone on the project shares it, and deleting the
-- project deletes it. Viewers read it; editors add, change and remove rows.
-- Outside agents (OAuth tokens) may read but never write it, so a connector
-- cannot plant words the in-app agent will act on.

create table if not exists public.survey_agent_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('name', 'wording')),
  heard text not null check (char_length(btrim(heard)) between 1 and 120),
  means text not null check (char_length(btrim(means)) between 1 and 200),
  -- The spoken form folded for matching ("D 101" = "d101").
  heard_key text generated always as (lower(regexp_replace(heard, '[^[:alnum:]]+', '', 'g'))) stored,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind, heard_key)
);

create index if not exists survey_agent_memory_project_idx
  on public.survey_agent_memory (project_id, kind);

alter table public.survey_agent_memory enable row level security;
revoke all on table public.survey_agent_memory from anon;
grant select, insert, update, delete on table public.survey_agent_memory to authenticated;

drop policy if exists "agent memory: project viewers read" on public.survey_agent_memory;
create policy "agent memory: project viewers read" on public.survey_agent_memory
  for select to authenticated
  using (public.user_can_access_project(project_id, 'viewer'));

drop policy if exists "agent memory: project editors add" on public.survey_agent_memory;
create policy "agent memory: project editors add" on public.survey_agent_memory
  for insert to authenticated
  with check (not public.is_agent_session() and public.user_can_access_project(project_id, 'editor'));

drop policy if exists "agent memory: project editors change" on public.survey_agent_memory;
create policy "agent memory: project editors change" on public.survey_agent_memory
  for update to authenticated
  using (not public.is_agent_session() and public.user_can_access_project(project_id, 'editor'))
  with check (not public.is_agent_session() and public.user_can_access_project(project_id, 'editor'));

drop policy if exists "agent memory: project editors remove" on public.survey_agent_memory;
create policy "agent memory: project editors remove" on public.survey_agent_memory
  for delete to authenticated
  using (not public.is_agent_session() and public.user_can_access_project(project_id, 'editor'));

-- At most 500 rows a project, stamped with the server's time.
create or replace function public.survey_agent_memory_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    if (select count(*) from public.survey_agent_memory where project_id = new.project_id) >= 500 then
      raise exception 'agent_memory_limit' using errcode = 'P0001';
    end if;
  else
    new.project_id := old.project_id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

revoke all on function public.survey_agent_memory_guard() from public, anon, authenticated;

drop trigger if exists survey_agent_memory_guard on public.survey_agent_memory;
create trigger survey_agent_memory_guard
  before insert or update on public.survey_agent_memory
  for each row execute function public.survey_agent_memory_guard();
