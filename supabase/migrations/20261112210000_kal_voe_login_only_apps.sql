-- One login for every Kal Voe app (Walkthru, Plot, Survey). The other apps
-- sign people in through this project's OAuth server ("Continue with Kal Voe
-- account"), the same server outside AI agents use. Those apps only need to
-- know who the person is; they must not read or change Survey data with the
-- token they get back. So:
--
--   * public.login_only_apps lists their OAuth client ids (added by the owner
--     when an app is registered; nothing in the app writes it).
--   * check_agent_request (PostgREST's pre-request hook) refuses every
--     database request from their tokens, and a restrictive storage policy
--     refuses every file request. Sign-in itself (Auth's /authorize, /token,
--     /userinfo) does not go through PostgREST, so it keeps working.
--   * They still count as agent sessions (client_id claim), so the existing
--     guards stop them from changing the password, email or consents.
--   * The consent page reads login_only_apps() to show a plain "Continue to
--     Walkthru" screen instead of the AI agent screen, and leaves them out of
--     the agent list.

create table if not exists public.login_only_apps (
  client_id uuid primary key,
  app_name text not null check (length(btrim(app_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

alter table public.login_only_apps enable row level security;
revoke all on table public.login_only_apps from public, anon, authenticated;
grant all on table public.login_only_apps to service_role;

-- Names and ids are not secret: the consent page needs them to tell a Kal Voe
-- app from an AI agent. Only people's own sessions may ask.
create or replace function public.login_only_apps()
returns table (client_id uuid, app_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.client_id, a.app_name
    from public.login_only_apps a
   where auth.uid() is not null
     and coalesce(auth.jwt() ->> 'client_id', '') = '';
$$;

revoke all on function public.login_only_apps() from public, anon;
grant execute on function public.login_only_apps() to authenticated, service_role;

-- True when the request carries a token issued to a login-only app.
create or replace function public.is_login_only_token()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'client_id', '') <> ''
     and exists (
       select 1 from public.login_only_apps a
        where a.client_id::text = auth.jwt() ->> 'client_id'
     );
$$;

revoke all on function public.is_login_only_token() from public;
grant execute on function public.is_login_only_token() to anon, authenticated, service_role;

-- Same as 20261022080000_agent_write_access.sql, plus the login-only refusal first.
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
  if public.is_login_only_token() then
    raise exception 'This app can only sign you in. It cannot use Survey data.'
      using errcode = '42501';
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

-- File requests go through the storage API, not PostgREST.
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "Login-only apps cannot use files" on storage.objects';
    execute 'create policy "Login-only apps cannot use files" on storage.objects as restrictive
               for all to authenticated
               using (not (select public.is_login_only_token()))
               with check (not (select public.is_login_only_token()))';
  end if;
end $$;
