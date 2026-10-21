-- What each outside AI agent changed, so the person can check on /agent-link.
-- Agents sign in through the OAuth server and their tokens carry `client_id`
-- (see 20261020230000_outside_agent_limits.sql). A trigger on the tables that
-- hold the person's work records every insert, update and delete an agent
-- makes. People's own edits are not logged here. Rows are kept 90 days.

create table if not exists public.agent_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  table_name text not null,
  row_id text,
  row_label text,
  created_at timestamptz not null default now()
);

create index if not exists agent_activity_user_time_idx
  on public.agent_activity (user_id, created_at desc);

alter table public.agent_activity enable row level security;

-- The person reads their own log; agents can't read or touch it. Only the
-- trigger below writes it.
drop policy if exists "People read their agents' activity" on public.agent_activity;
create policy "People read their agents' activity"
  on public.agent_activity
  for select
  to authenticated
  using (user_id = auth.uid() and not public.is_agent_session());

revoke all on public.agent_activity from anon, authenticated;
grant select on public.agent_activity to authenticated;
grant all on public.agent_activity to service_role;

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
    left(coalesce(v_row ->> 'name', v_row ->> 'title', v_row ->> 'annotation_type', v_row ->> 'email'), 120)
  );
  delete from public.agent_activity
   where user_id = v_uid and created_at < now() - interval '90 days';
  return null;
end;
$$;

revoke all on function public.log_agent_write() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'projects', 'documents', 'document_annotations', 'spaces', 'survey_items',
    'templates', 'kits', 'document_collaborators', 'project_collaborators',
    'template_collaborators', 'document_invites', 'project_invites',
    'template_invites', 'excel_schema_mapping'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists log_agent_write on public.%I', t);
      execute format(
        'create trigger log_agent_write after insert or update or delete on public.%I
           for each row execute function public.log_agent_write()', t);
    end if;
  end loop;
end $$;

-- When each of the person's agents last used its sign-in. Agents can't call it.
create or replace function public.my_agent_last_active()
returns table (client_id text, last_active timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.oauth_client_id::text, max(coalesce(s.updated_at, s.created_at))
    from auth.sessions s
   where s.user_id = auth.uid()
     and s.oauth_client_id is not null
     and not public.is_agent_session()
   group by s.oauth_client_id;
$$;

revoke all on function public.my_agent_last_active() from public, anon;
grant execute on function public.my_agent_last_active() to authenticated;
