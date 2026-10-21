-- What an outside AI agent changed through the survey-mcp connector, with the
-- before-state needed to undo it, so the person can reverse an agent's change
-- from /agent-link. This is distinct from agent_activity (20261021050000),
-- which is a trigger-written audit trail with no before-state: the connector
-- writes a row here itself, carrying the surgical before-state (the same shape
-- the change_id token encodes — only the sub-fields the change touched).
--
-- Agents cannot read or undo from here (an agent undoes with its own change_id
-- via the connector's undo_change). Only the person reads their rows and marks
-- one undone; the actual Yjs reversal runs in the person's browser on their
-- token, so this table stores data, never applies it.

create table if not exists public.agent_change (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  document_id uuid not null,
  kind text not null check (kind in ('answers', 'note_append', 'entity', 'create')),
  marker_id text not null,
  -- The before-state (answers: prior values of the set checklist entries;
  -- note_append: the appended segment; entity: prior id/name/colour; create:
  -- empty, undo deletes the marker). Bounded by the request that made it.
  payload jsonb not null default '{}'::jsonb,
  summary text,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists agent_change_user_time_idx
  on public.agent_change (user_id, created_at desc);

alter table public.agent_change enable row level security;

-- The agent writes its own rows (a live agent session, acting as the person).
drop policy if exists "Agents record their own changes" on public.agent_change;
create policy "Agents record their own changes"
  on public.agent_change
  for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_agent_session());

-- The person reads their agents' changes and marks one undone; agents can do
-- neither (consistent with agent_activity).
drop policy if exists "People read their agents' changes" on public.agent_change;
create policy "People read their agents' changes"
  on public.agent_change
  for select
  to authenticated
  using (user_id = auth.uid() and not public.is_agent_session());

drop policy if exists "People mark their agents' changes undone" on public.agent_change;
create policy "People mark their agents' changes undone"
  on public.agent_change
  for update
  to authenticated
  using (user_id = auth.uid() and not public.is_agent_session())
  with check (user_id = auth.uid() and not public.is_agent_session());

revoke all on public.agent_change from anon, authenticated;
grant select, insert, update on public.agent_change to authenticated;
grant all on public.agent_change to service_role;

-- Keep 90 days, pruned opportunistically when the owner inserts a new row —
-- the same no-scheduler pattern as prune_agent_activity.
create or replace function public.prune_agent_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.agent_change
   where user_id = new.user_id and created_at < now() - interval '90 days';
  return null;
end;
$$;

drop trigger if exists prune_agent_change_t on public.agent_change;
create trigger prune_agent_change_t
  after insert on public.agent_change
  for each row execute function public.prune_agent_change();
