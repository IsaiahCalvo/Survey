-- Outside agents (Supabase OAuth server) get the person's own token plus a
-- client_id claim. The person now chooses on the consent page whether the
-- agent may only read or may also make changes. Supabase's OAuth server has
-- no custom scopes yet, so the choice lives here, keyed by person and agent,
-- and the database enforces it on every request:
--
--   * check_agent_request (PostgREST's pre-request hook) refuses a read-only
--     agent any request that is not a read-only transaction. PostgREST runs
--     GET/HEAD, and POST to STABLE/IMMUTABLE functions, read only; anything
--     that writes (inserts, updates, deletes, VOLATILE RPCs) is refused,
--     except agent bookkeeping the edge functions do with the agent's token.
--   * A restrictive storage policy refuses its file uploads, moves and deletes.
--
-- Writes a write-agent makes still pass every RLS policy for the person's
-- role. Removing the agent on /agent-link still cuts it off at once
-- (agent_session_ok) and forgets the choice, so letting it in again starts
-- read only.

create table if not exists public.agent_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  can_write boolean not null default false,
  chosen_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

alter table public.agent_access enable row level security;
revoke all on table public.agent_access from public, anon, authenticated;
grant all on table public.agent_access to service_role;

-- Agents let in before this choice existed could already write; keep them as they were.
insert into public.agent_access (user_id, client_id, can_write)
select c.user_id, c.client_id, true
  from auth.oauth_consents c
 where c.revoked_at is null
on conflict (user_id, client_id) do nothing;

-- The person's own session sets the choice on the consent page, before Allow.
create or replace function public.set_agent_access(p_client_id uuid, p_write boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if public.is_agent_session() then
    raise exception 'agents cannot change what agents may do' using errcode = '42501';
  end if;
  insert into public.agent_access (user_id, client_id, can_write, chosen_at)
  values (auth.uid(), p_client_id, coalesce(p_write, false), now())
  on conflict (user_id, client_id) do update set can_write = excluded.can_write, chosen_at = excluded.chosen_at;
end;
$$;

revoke all on function public.set_agent_access(uuid, boolean) from public, anon;
grant execute on function public.set_agent_access(uuid, boolean) to authenticated, service_role;

-- True for people's own sign-ins and for agents the person let make changes.
create or replace function public.agent_can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') = ''
    or exists (
      select 1 from public.agent_access a
       where a.user_id = auth.uid()
         and a.client_id::text = auth.jwt() ->> 'client_id'
         and a.can_write
    );
$$;

-- check_agent_request runs as the caller's role, signed out included.
revoke all on function public.agent_can_write() from public;
grant execute on function public.agent_can_write() to anon, authenticated, service_role;

-- 'person' for a person's own sign-in, else 'read' or 'write' for the agent.
-- Edge functions call it (GET) to refuse a write tool early.
create or replace function public.my_agent_access()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when coalesce(auth.jwt() ->> 'client_id', '') = '' then 'person'
    when public.agent_can_write() then 'write'
    else 'read'
  end;
$$;

revoke all on function public.my_agent_access() from public, anon;
grant execute on function public.my_agent_access() to authenticated, service_role;

create or replace function public.check_agent_request()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'client_id', '') = '' then
    return;
  end if;
  if not public.agent_session_ok() then
    raise exception 'This AI agent was removed. The person must let it in again.'
      using errcode = '42501';
  end if;
  if current_setting('transaction_read_only', true) <> 'on'
     and coalesce(current_setting('request.path', true), '') <> '/rpc/agent_rate_hit'
     and not public.agent_can_write() then
    raise exception 'This AI agent can only read. The person can let it make changes when they let it in.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.check_agent_request() from public;
grant execute on function public.check_agent_request() to anon, authenticated, service_role;

notify pgrst, 'reload config';

-- File uploads, moves and deletes go through the storage API, not PostgREST.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Read-only agents cannot add files" on storage.objects';
    execute 'create policy "Read-only agents cannot add files" on storage.objects as restrictive
               for insert to authenticated with check ((select public.agent_can_write()))';
    execute 'drop policy if exists "Read-only agents cannot change files" on storage.objects';
    execute 'create policy "Read-only agents cannot change files" on storage.objects as restrictive
               for update to authenticated using ((select public.agent_can_write())) with check ((select public.agent_can_write()))';
    execute 'drop policy if exists "Read-only agents cannot remove files" on storage.objects';
    execute 'create policy "Read-only agents cannot remove files" on storage.objects as restrictive
               for delete to authenticated using ((select public.agent_can_write()))';
  end if;
end $$;

-- Removing the agent forgets the choice, so letting it in again starts read only.
create or replace function public.forget_agent_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or (new.revoked_at is not null and old.revoked_at is null) then
    delete from public.agent_access where user_id = old.user_id and client_id = old.client_id;
  end if;
  return null;
end;
$$;

revoke all on function public.forget_agent_access() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'forget_agent_access' and tgrelid = 'auth.oauth_consents'::regclass) then
    create trigger forget_agent_access
      after update of revoked_at or delete on auth.oauth_consents
      for each row execute function public.forget_agent_access();
  end if;
end;
$$;
