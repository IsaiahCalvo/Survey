-- Outside AI agents sign in through Survey's consent screen (Supabase OAuth
-- server). Their tokens are ordinary `authenticated` tokens for the person,
-- plus a `client_id` claim, so every existing RLS policy already gives them
-- exactly the person's role on each document and the person's plan.
--
-- On top of that, an agent never touches the person's linked accounts, never
-- lets other agents in, and never changes the plan. (Paying and deleting the
-- account are refused in the edge functions; see _shared/agentSession.ts.)

create or replace function public.is_agent_session()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> '';
$$;

revoke all on function public.is_agent_session() from public;
grant execute on function public.is_agent_session() to anon, authenticated, service_role;

-- Linked accounts (Microsoft and the like) hold the person's tokens elsewhere.
drop policy if exists "Agents cannot use linked accounts" on public.connected_services;
create policy "Agents cannot use linked accounts"
  on public.connected_services
  as restrictive
  for all
  to authenticated
  using (not public.is_agent_session())
  with check (not public.is_agent_session());

-- Agents can't see or manage other agents' links.
drop policy if exists "Agents cannot manage agent links" on public.agent_links;
create policy "Agents cannot manage agent links"
  on public.agent_links
  as restrictive
  for all
  to authenticated
  using (not public.is_agent_session())
  with check (not public.is_agent_session());

-- Only the person can let an agent in: an agent can't approve another one.
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
  if public.is_agent_session() then
    raise exception 'agents cannot approve agents' using errcode = '42501';
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

revoke all on function public.approve_agent_link(text) from public, anon;
grant execute on function public.approve_agent_link(text) to authenticated;

-- Nor remove the person's other agents (the update runs as definer, so the
-- restrictive policy above doesn't reach it).
create or replace function public.revoke_agent_link(p_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with done as (
    update public.agent_links
       set status = 'revoked', token_hash = null, refresh_token_hash = null
     where id = p_id and user_id = auth.uid() and status <> 'revoked'
       and not public.is_agent_session()
    returning 1
  )
  select exists (select 1 from done);
$$;

revoke all on function public.revoke_agent_link(uuid) from public, anon;
grant execute on function public.revoke_agent_link(uuid) to authenticated;

-- Plan-downgrade housekeeping takes any user id and archives that user's
-- extra projects and documents. Only the Stripe webhook (service role) runs
-- it; signed-in callers (people or their agents) could aim it at someone
-- else's account, so they lose it.
revoke execute on function public.handle_downgrade_to_free(uuid) from public, anon, authenticated;
revoke execute on function public.archive_excess_documents(uuid, integer) from public, anon, authenticated;
revoke execute on function public.archive_excess_projects(uuid, integer) from public, anon, authenticated;
revoke execute on function public.archive_excess_projects(uuid, uuid) from public, anon, authenticated;
grant execute on function public.handle_downgrade_to_free(uuid) to service_role;
grant execute on function public.archive_excess_documents(uuid, integer) to service_role;
grant execute on function public.archive_excess_projects(uuid, integer) to service_role;
grant execute on function public.archive_excess_projects(uuid, uuid) to service_role;
