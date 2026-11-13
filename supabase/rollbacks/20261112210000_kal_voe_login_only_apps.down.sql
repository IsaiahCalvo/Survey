-- Undo 20261112210000_kal_voe_login_only_apps.sql: restore the previous
-- pre-request hook, then drop the login-only pieces.
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

notify pgrst, 'reload config';

drop policy if exists "Login-only apps cannot use files" on storage.objects;
drop function if exists public.is_login_only_token();
drop function if exists public.login_only_apps();
drop table if exists public.login_only_apps;
