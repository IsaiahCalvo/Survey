-- Agent log rows older than 90 days: never shown, and pruned for everyone
-- whenever any agent writes, not only when that same person's agent does
-- (a person who stops using agents would otherwise keep old rows forever).

create index if not exists agent_activity_created_idx on public.agent_activity (created_at);

drop policy if exists "People read their agents' activity" on public.agent_activity;
create policy "People read their agents' activity"
  on public.agent_activity
  for select
  to authenticated
  using (user_id = auth.uid() and not public.is_agent_session() and created_at > now() - interval '90 days');

create or replace function public.prune_agent_activity()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.agent_activity
   where id in (
     select id from public.agent_activity
      where created_at < now() - interval '90 days'
      order by created_at
      limit 500
   );
$$;

revoke all on function public.prune_agent_activity() from public, anon, authenticated;

create or replace function public.log_agent_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_agent_session() then
    return null;
  end if;
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  insert into public.agent_activity (user_id, client_id, action, table_name, row_id, row_label)
  values (
    v_uid,
    auth.jwt() ->> 'client_id',
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    left(coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'annotation_type', v_row ->> 'email', v_row ->> 'target_email', v_row ->> 'sheet_name'), 120)
  );
  perform public.prune_agent_activity();
  return null;
end;
$$;
