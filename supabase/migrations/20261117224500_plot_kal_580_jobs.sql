-- KAL-580: Plot jobs in a Survey Project (Kal Voe suite).
--
-- A designer signs in to Plot with their Survey account and puts a Plot job
-- (a Plot Project, one .plt file) in a Survey Project. Everyone in that
-- Project sees the job in their Plot. Who may do what follows the Project's
-- own roles: a viewer sees it, an editor adds, changes and removes it.
--
-- The job's id is the Plot Project's own id, made on the designer's computer
-- and kept in the .plt. Plot may make a job offline and send it later, or send
-- it again after a lost answer: the same id always lands on the same row, so
-- a job is never listed twice.
--
-- The job file itself stays on the designer's computer for now; KAL-581 puts
-- it in Plot's own file store and fills file_key. Only adds things.
--
-- Plot's rows live in their own schema, `plot`. It is not exposed through the
-- API: Plot reads and writes through the public plot_* functions below, which
-- run as the signed-in user, so the row rules here always apply.

create schema if not exists plot;
comment on schema plot is 'KAL-580: Plot (shop drawings) rows. Reached through public.plot_* functions.';
grant usage on schema plot to authenticated;

-- 1. One row per Plot job ----------------------------------------------------
create table if not exists plot.jobs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  sheets integer not null default 0 check (sheets >= 0),
  devices integer not null default 0 check (devices >= 0),
  revision text check (revision is null or char_length(revision) <= 200),
  saved_at timestamptz,
  file_key text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);

create index if not exists plot_jobs_project_idx on plot.jobs (project_id) where removed_at is null;

comment on table plot.jobs is
  'KAL-580: Plot jobs put in a Survey Project. id = the Plot Project id in the .plt, so a resend never makes a second row.';

-- Who made a row and when stays as it was; who last changed it is the caller.
create or replace function plot.jobs_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists plot_jobs_before_write on plot.jobs;
create trigger plot_jobs_before_write
  before insert or update on plot.jobs
  for each row execute function plot.jobs_before_write();

alter table plot.jobs enable row level security;

drop policy if exists plot_jobs_select on plot.jobs;
create policy plot_jobs_select on plot.jobs
  for select to authenticated
  using (public.user_can_access_project(project_id, 'viewer'));

drop policy if exists plot_jobs_insert on plot.jobs;
create policy plot_jobs_insert on plot.jobs
  for insert to authenticated
  with check (public.user_can_access_project(project_id, 'editor'));

-- Moving a job to another Project needs edit rights on both.
drop policy if exists plot_jobs_update on plot.jobs;
create policy plot_jobs_update on plot.jobs
  for update to authenticated
  using (public.user_can_access_project(project_id, 'editor'))
  with check (public.user_can_access_project(project_id, 'editor'));

drop policy if exists plot_jobs_delete on plot.jobs;
create policy plot_jobs_delete on plot.jobs
  for delete to authenticated
  using (public.user_can_access_project(project_id, 'owner'));

grant select, insert, update, delete on plot.jobs to authenticated;
revoke all on plot.jobs from anon;

-- 2. The Projects a signed-in person is in, with their role -----------------
-- Security definer reads only the caller's own rows: Projects they own, and
-- Projects they are an active member of. Archived Projects stay out.
create or replace function public.plot_my_projects()
returns table (project_id uuid, name text, role text, updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name::text, 'owner'::text, p.updated_at
    from public.projects p
   where p.user_id = auth.uid()
     and p.user_archived_at is null
     and coalesce(p.archived, false) = false
  union all
  select p.id, p.name::text, c.role, p.updated_at
    from public.project_collaborators c
    join public.projects p on p.id = c.project_id
   where c.user_id = auth.uid()
     and c.status = 'active'
     and c.role in ('viewer', 'editor', 'owner')
     and p.user_id <> auth.uid()
     and p.user_archived_at is null
     and coalesce(p.archived, false) = false
  order by 4 desc nulls last;
$$;

revoke all on function public.plot_my_projects() from public, anon;
grant execute on function public.plot_my_projects() to authenticated;

-- 3. The jobs a signed-in person can see -------------------------------------
-- Security invoker: the row rules above decide what comes back.
create or replace function public.plot_list_jobs()
returns table (
  id uuid,
  project_id uuid,
  name text,
  file_name text,
  sheets integer,
  devices integer,
  revision text,
  saved_at timestamptz,
  file_key text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select j.id, j.project_id, j.name, j.file_name, j.sheets, j.devices, j.revision,
         j.saved_at, j.file_key, j.created_by, j.updated_by, j.created_at, j.updated_at
    from plot.jobs j
   where j.removed_at is null
   order by j.updated_at desc;
$$;

revoke all on function public.plot_list_jobs() from public, anon;
grant execute on function public.plot_list_jobs() to authenticated;

-- 4. Put a job in a Project, or send its latest details ---------------------
-- Insert or update by the job's own id, so sending twice is the same as once.
-- A job removed earlier comes back when it is sent again.
create or replace function public.plot_save_job(
  p_id uuid,
  p_project_id uuid,
  p_name text,
  p_file_name text,
  p_sheets integer default 0,
  p_devices integer default 0,
  p_revision text default null,
  p_saved_at timestamptz default null
)
returns plot.jobs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  saved plot.jobs;
begin
  if auth.uid() is null then
    raise exception 'Sign in to share a Plot job.' using errcode = '42501';
  end if;
  insert into plot.jobs as j (id, project_id, name, file_name, sheets, devices, revision, saved_at)
  values (p_id, p_project_id, btrim(p_name), btrim(p_file_name),
          greatest(coalesce(p_sheets, 0), 0), greatest(coalesce(p_devices, 0), 0), p_revision, p_saved_at)
  on conflict (id) do update
    set project_id = excluded.project_id,
        name = excluded.name,
        file_name = excluded.file_name,
        sheets = excluded.sheets,
        devices = excluded.devices,
        revision = excluded.revision,
        saved_at = excluded.saved_at,
        removed_at = null
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.plot_save_job(uuid, uuid, text, text, integer, integer, text, timestamptz) from public, anon;
grant execute on function public.plot_save_job(uuid, uuid, text, text, integer, integer, text, timestamptz) to authenticated;

-- 5. Take a job out of its Project (the file on the computer is untouched) ---
create or replace function public.plot_remove_job(p_id uuid)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  update plot.jobs set removed_at = now() where id = p_id and removed_at is null;
  return found;
end;
$$;

revoke all on function public.plot_remove_job(uuid) from public, anon;
grant execute on function public.plot_remove_job(uuid) to authenticated;
