-- Mark library (beta flag 'mark-library', Survey Nightly only): marks a
-- person saves once and drops on any page again, Drawboard Projects'
-- "Markup Library". Docs: docs/MARK-LIBRARY.md.
--
-- Two kinds of library live in one table:
--   personal - one per person, follows them to every document; only they
--              see it.
--   project  - one per project, shared with the project's people.
--
-- Who can do what in a project library (user_can_access_project roles):
--   viewer and up  read the items and drop them on a page;
--   editor and up  add items;
--   an item's author (still an editor) or a project owner  rename, tag,
--                  replace and delete it.
--
-- `payload` is the saved marks in the app's clipboard shape (marks,
-- callouts and Survey Markers with their page-unit box), checked and
-- drawn by src/markLibrary/markLibraryModel.js.

create table if not exists public.mark_library_items (
  id uuid primary key default gen_random_uuid(),
  library text not null check (library in ('personal', 'project')),
  project_id uuid references public.projects (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  kinds text[] not null default '{}' check (cardinality(kinds) <= 12),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 1048576),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mark_library_items_scope check (
    (library = 'personal' and project_id is null)
    or (library = 'project' and project_id is not null)
  )
);

create index if not exists mark_library_items_personal_idx
  on public.mark_library_items (created_by, updated_at desc) where library = 'personal';
create index if not exists mark_library_items_project_idx
  on public.mark_library_items (project_id, updated_at desc) where library = 'project';

alter table public.mark_library_items enable row level security;
revoke all on table public.mark_library_items from anon;
grant select, insert, update, delete on table public.mark_library_items to authenticated;

drop policy if exists "mark library: read" on public.mark_library_items;
create policy "mark library: read" on public.mark_library_items
  for select to authenticated
  using (
    (library = 'personal' and created_by = (select auth.uid()))
    or (library = 'project' and public.user_can_access_project(project_id, 'viewer'))
  );

drop policy if exists "mark library: add" on public.mark_library_items;
create policy "mark library: add" on public.mark_library_items
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      library = 'personal'
      or (library = 'project' and public.user_can_access_project(project_id, 'editor'))
    )
  );

-- USING reads the row as it was, WITH CHECK the row as it will be: moving a
-- personal item into a project needs editor there; only the author can take
-- a project item back to a personal library (created_by never changes).
drop policy if exists "mark library: change" on public.mark_library_items;
create policy "mark library: change" on public.mark_library_items
  for update to authenticated
  using (
    (library = 'personal' and created_by = (select auth.uid()))
    or (library = 'project' and (
      (created_by = (select auth.uid()) and public.user_can_access_project(project_id, 'editor'))
      or public.user_can_access_project(project_id, 'owner')
    ))
  )
  with check (
    (library = 'personal' and created_by = (select auth.uid()))
    or (library = 'project' and public.user_can_access_project(project_id, 'editor'))
  );

drop policy if exists "mark library: delete" on public.mark_library_items;
create policy "mark library: delete" on public.mark_library_items
  for delete to authenticated
  using (
    (library = 'personal' and created_by = (select auth.uid()))
    or (library = 'project' and (
      (created_by = (select auth.uid()) and public.user_can_access_project(project_id, 'editor'))
      or public.user_can_access_project(project_id, 'owner')
    ))
  );

-- Tidy tags, keep the author and the server's clock, and cap each library at
-- 2000 items so a stuck import loop can't fill the table.
create or replace function public.mark_library_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  new.name := btrim(new.name);
  new.tags := coalesce((
    select array_agg(t order by first_seen)
      from (
        select left(btrim(tag), 40) as t, min(ord) as first_seen
          from unnest(coalesce(new.tags, '{}')) with ordinality as u(tag, ord)
         where btrim(tag) <> ''
         group by left(btrim(tag), 40)
      ) tidy
  ), '{}');
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if tg_op = 'INSERT'
     or new.library is distinct from old.library
     or new.project_id is distinct from old.project_id then
    if new.library = 'personal' then
      select count(*) into v_count from public.mark_library_items
       where library = 'personal' and created_by = new.created_by;
    else
      select count(*) into v_count from public.mark_library_items
       where library = 'project' and project_id = new.project_id;
    end if;
    if v_count >= 2000 then
      raise exception 'mark_library_full' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.mark_library_items_guard() from public, anon, authenticated;

drop trigger if exists mark_library_items_guard on public.mark_library_items;
create trigger mark_library_items_guard
  before insert or update on public.mark_library_items
  for each row execute function public.mark_library_items_guard();

-- What the signed-in person may do with a project's library, and the
-- project's name (the {{project.name}} token). Nothing for a project they
-- can't open.
create or replace function public.mark_library_project_access(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if auth.uid() is null or p_project_id is null
     or not public.user_can_access_project(p_project_id, 'viewer') then
    return jsonb_build_object('can_read', false, 'can_add', false, 'can_manage', false, 'project_name', null);
  end if;
  select name into v_name from public.projects where id = p_project_id;
  return jsonb_build_object(
    'can_read', true,
    'can_add', public.user_can_access_project(p_project_id, 'editor'),
    'can_manage', public.user_can_access_project(p_project_id, 'owner'),
    'project_name', v_name
  );
end;
$$;

revoke all on function public.mark_library_project_access(uuid) from public, anon;
grant execute on function public.mark_library_project_access(uuid) to authenticated;

-- Live updates: a teammate's new item shows up without a reload. Realtime
-- applies the read policy above to each listener.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mark_library_items'
     ) then
    alter publication supabase_realtime add table public.mark_library_items;
  end if;
end;
$$;

-- Flag: a beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('mark-library', 'off', 'Mark library: save marks to a personal or project library and drop them on any page.')
on conflict (key) do nothing;
