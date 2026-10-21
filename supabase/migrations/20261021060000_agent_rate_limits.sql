-- Per-agent hourly limits on the edge functions an outside AI agent can call
-- (send-email, invites, Excel apply; see supabase/functions/_shared/agentSession.ts).
-- The agent comes from the caller's own token, so one agent can't use up
-- another's allowance. Each counted call also shows in the person's agent log.

create table if not exists public.agent_rate_counters (
  client_id text not null,
  fn text not null,
  window_start timestamptz not null,
  calls integer not null default 0,
  primary key (client_id, fn, window_start)
);

alter table public.agent_rate_counters enable row level security;
revoke all on public.agent_rate_counters from anon, authenticated;
grant all on public.agent_rate_counters to service_role;

alter table public.agent_activity drop constraint if exists agent_activity_action_check;
alter table public.agent_activity
  add constraint agent_activity_action_check check (action in ('insert', 'update', 'delete', 'call'));

-- True when the call is allowed. People (no client_id) always are.
create or replace function public.agent_rate_hit(p_fn text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client text := nullif(auth.jwt() ->> 'client_id', '');
  v_window timestamptz := date_trunc('hour', now());
  v_calls integer;
begin
  if v_client is null then
    return true;
  end if;
  if p_fn not in ('send-email', 'send-invite-email', 'send-profile-change-notification', 'excel-apply-changeset') then
    raise exception 'unknown function %', p_fn using errcode = '22023';
  end if;
  insert into public.agent_rate_counters as c (client_id, fn, window_start, calls)
  values (v_client, p_fn, v_window, 1)
  on conflict (client_id, fn, window_start) do update set calls = c.calls + 1
  returning calls into v_calls;
  delete from public.agent_rate_counters
   where client_id = v_client and window_start < v_window - interval '1 day';
  if auth.uid() is not null then
    insert into public.agent_activity (user_id, client_id, action, table_name, row_label)
    values (auth.uid(), v_client, 'call', p_fn, case when v_calls > p_limit then 'refused: over the hourly limit' end);
  end if;
  return v_calls <= p_limit;
end;
$$;

revoke all on function public.agent_rate_hit(text, integer) from public, anon;
grant execute on function public.agent_rate_hit(text, integer) to authenticated, service_role;
