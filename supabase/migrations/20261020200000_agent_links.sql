-- Agent sign-in ("user claimed" flow from auth.md): an AI agent asks for a
-- short code, the signed-in user types it into /agent-link, and the agent
-- then gets a short-lived, read-only token for that user. Only hashes of the
-- agent's secrets are stored. The agent-auth edge function (service role)
-- does all agent-side reads and writes; users only approve, list and revoke.
create table public.agent_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  agent_name text not null check (char_length(agent_name) between 1 and 80),
  user_code text not null unique,
  device_code_hash text not null unique,
  token_hash text unique,
  scopes text[] not null default array['read'],
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  code_expires_at timestamptz not null default now() + interval '10 minutes',
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create index agent_links_user_idx on public.agent_links (user_id);

alter table public.agent_links enable row level security;
revoke all on table public.agent_links from public, anon, authenticated;
grant select (id, agent_name, scopes, status, token_expires_at, created_at, approved_at)
  on public.agent_links to authenticated;
grant all on public.agent_links to service_role;

create policy agent_links_owner_read on public.agent_links
for select to authenticated using (user_id = auth.uid());

-- The signed-in user claims a pending code. Returns the agent's name so the
-- page can say who was let in, or null when the code is unknown or expired.
create or replace function public.approve_agent_link(p_user_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.agent_links
     set user_id = auth.uid(), status = 'approved', approved_at = now()
   where user_code = upper(trim(p_user_code))
     and status = 'pending'
     and user_id is null
     and code_expires_at > now()
  returning agent_name into v_name;
  return v_name;
end;
$$;

create or replace function public.revoke_agent_link(p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with done as (
    update public.agent_links set status = 'revoked', token_hash = null
     where id = p_id and user_id = auth.uid() and status <> 'revoked'
    returning 1
  )
  select exists (select 1 from done);
$$;

revoke all on function public.approve_agent_link(text) from public, anon;
revoke all on function public.revoke_agent_link(uuid) from public, anon;
grant execute on function public.approve_agent_link(text) to authenticated;
grant execute on function public.revoke_agent_link(uuid) to authenticated;
