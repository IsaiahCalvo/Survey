-- Removing an agent on /agent-link (revokeGrant) ends its sessions and marks
-- the grant revoked, but an access token it already holds stays valid until
-- it expires (up to an hour). Close that gap: every API request from an agent
-- token checks that its grant and session are still live, and is refused
-- once the person has removed it. People's own sign-ins skip the lookup.

create or replace function public.agent_session_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') = ''
    or (
      exists (
        select 1 from auth.sessions s
         where s.id::text = auth.jwt() ->> 'session_id'
           and s.user_id = auth.uid()
           and (s.not_after is null or s.not_after > now())
      )
      and not exists (
        select 1 from auth.oauth_consents c
         where c.user_id = auth.uid()
           and c.client_id::text = auth.jwt() ->> 'client_id'
           and c.revoked_at is not null
      )
    );
$$;

revoke all on function public.agent_session_ok() from public;
grant execute on function public.agent_session_ok() to anon, authenticated, service_role;

-- PostgREST runs this before every request (tables, views and RPCs alike).
create or replace function public.check_agent_request()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.agent_session_ok() then
    raise exception 'This AI agent was removed. The person must let it in again.'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.check_agent_request() from public;
grant execute on function public.check_agent_request() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.check_agent_request';
notify pgrst, 'reload config';

-- File downloads and uploads go through the storage API, not PostgREST.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Removed agents cannot use files" on storage.objects';
    execute 'create policy "Removed agents cannot use files" on storage.objects as restrictive
               for all to authenticated
               using (public.agent_session_ok()) with check (public.agent_session_ok())';
  end if;
end $$;
