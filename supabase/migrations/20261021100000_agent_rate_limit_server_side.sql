-- Harden agent_rate_hit: the hourly limit must not be taken from the caller.
-- An agent can call this RPC straight from REST, so a caller-supplied p_limit
-- let it pass any number and never be capped. The limit now lives in the
-- function, keyed by function name; p_limit is kept only for the old call
-- shape and ignored. Unknown function names are still rejected.
create or replace function public.agent_rate_hit(p_fn text, p_limit integer default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client text := nullif(auth.jwt() ->> 'client_id', '');
  v_window timestamptz := date_trunc('hour', now());
  v_limit integer := case p_fn
    when 'send-email' then 10
    when 'send-invite-email' then 10
    when 'send-profile-change-notification' then 5
    when 'excel-apply-changeset' then 60
    else null
  end;
  v_calls integer;
begin
  if v_client is null then
    return true;
  end if;
  if v_limit is null then
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
    values (auth.uid(), v_client, 'call', p_fn, case when v_calls > v_limit then 'refused: over the hourly limit' end);
  end if;
  return v_calls <= v_limit;
end;
$$;

revoke all on function public.agent_rate_hit(text, integer) from public, anon;
grant execute on function public.agent_rate_hit(text, integer) to authenticated, service_role;
