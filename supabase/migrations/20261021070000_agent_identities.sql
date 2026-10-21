-- An outside agent can show who it is with an AgentID (AgentMail) token; the
-- agent-identity edge function checks it and records it here, next to the
-- person's grant. It is information for the person, never access.
create table if not exists public.agent_identities (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  agentid_sub text not null,
  agent_email text,
  agent_name text,
  owner_sub text,
  owner_email text,
  owner_human_verified boolean not null default false,
  verified_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table public.agent_identities enable row level security;

drop policy if exists "People read their agents' identities" on public.agent_identities;
create policy "People read their agents' identities"
  on public.agent_identities
  for select
  to authenticated
  using (user_id = auth.uid() and not public.is_agent_session());

revoke all on public.agent_identities from anon, authenticated;
grant select on public.agent_identities to authenticated;
grant all on public.agent_identities to service_role;
