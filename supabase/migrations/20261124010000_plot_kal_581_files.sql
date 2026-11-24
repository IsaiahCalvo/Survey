-- KAL-581: Plot job files in Cloudflare R2, inside Plot's share of the free tier.
--
-- A shared Plot job's .plt (its floor plan PDFs and photos sit inside it) is
-- kept in the R2 bucket `plot-files`, so someone in the same Survey Project
-- can open it on another computer. The `plot-job-file` edge function signs a
-- short upload or download link after checking the caller's role in the job's
-- Project, and charges each link to this ledger first.
--
-- Survey, Walkthru and Plot share one Cloudflare account and split 80% of its
-- free tier (KAL-578). Plot's share: 1.5 GB stored, 150,000 writes (Class A)
-- and 1,500,000 reads (Class B) over a rolling 31 days. Past it, the function
-- says no and Plot keeps the job on the designer's computer only, as before.
--
-- Only adds things. Never deletes a job row.

alter table plot.jobs add column if not exists file_bytes bigint
  check (file_bytes is null or file_bytes >= 0);

comment on column plot.jobs.file_key is
  'KAL-581: the job file''s key in R2 bucket plot-files (jobs/<id>/<revision>.plt), once uploaded.';

-- 1. What Plot holds in R2 -----------------------------------------------------
-- A row is made when an upload link is signed (so a link nobody uses still
-- counts until it is cleared) and marked committed once the file is there.
create table if not exists plot.r2_objects (
  key text primary key check (char_length(key) between 1 and 512),
  job_id uuid not null,
  bytes bigint not null check (bytes >= 0),
  committed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists plot_r2_objects_job_idx on plot.r2_objects (job_id);
alter table plot.r2_objects enable row level security;
revoke all on plot.r2_objects from public, anon, authenticated;
comment on table plot.r2_objects is
  'KAL-581: Plot''s objects in R2 bucket plot-files. Their bytes are counted against Plot''s share.';

-- 2. Operations Plot caused, per UTC day --------------------------------------
create table if not exists plot.r2_usage_daily (
  day date primary key,
  class_a bigint not null default 0 check (class_a >= 0),
  class_b bigint not null default 0 check (class_b >= 0)
);
alter table plot.r2_usage_daily enable row level security;
revoke all on plot.r2_usage_daily from public, anon, authenticated;

create or replace function plot.r2_limits()
returns table (max_bytes bigint, max_class_a bigint, max_class_b bigint)
language sql
immutable
set search_path = ''
as $$ select 1500000000::bigint, 150000::bigint, 1500000::bigint $$;

-- 3. The caller's role on one job (viewer, editor, owner, or null) -----------
create or replace function public.plot_job_role(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.user_can_access_project(j.project_id, 'owner') then 'owner'
    when public.user_can_access_project(j.project_id, 'editor') then 'editor'
    when public.user_can_access_project(j.project_id, 'viewer') then 'viewer'
  end
    from plot.jobs j
   where j.id = p_id and j.removed_at is null and auth.uid() is not null;
$$;
revoke all on function public.plot_job_role(uuid) from public, anon;
grant execute on function public.plot_job_role(uuid) to authenticated;

-- 4. Reserve room under the share, or say no ----------------------------------
-- Called by the edge function (service role) before it signs a link.
create or replace function public.plot_r2_reserve(
  p_key text,
  p_job_id uuid,
  p_bytes bigint,
  p_class_a bigint,
  p_class_b bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limits record;
  v_day date := (now() at time zone 'utc')::date;
  v_a bigint;
  v_b bigint;
  v_stored bigint;
begin
  if coalesce(p_bytes, 0) < 0 or coalesce(p_class_a, 0) < 0 or coalesce(p_class_b, 0) < 0 then
    raise exception 'plot_r2_reserve: negative amounts';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.plot_r2_reserve'));
  select * into v_limits from plot.r2_limits();
  select coalesce(sum(class_a), 0), coalesce(sum(class_b), 0) into v_a, v_b
    from plot.r2_usage_daily where day > v_day - 31;
  select coalesce(sum(bytes), 0) into v_stored
    from plot.r2_objects where p_key is null or key <> p_key;
  if v_a + coalesce(p_class_a, 0) > v_limits.max_class_a
     or v_b + coalesce(p_class_b, 0) > v_limits.max_class_b
     or (p_key is not null and v_stored + coalesce(p_bytes, 0) > v_limits.max_bytes) then
    return false;
  end if;
  insert into plot.r2_usage_daily as u (day, class_a, class_b)
  values (v_day, coalesce(p_class_a, 0), coalesce(p_class_b, 0))
  on conflict (day) do update
    set class_a = u.class_a + excluded.class_a,
        class_b = u.class_b + excluded.class_b;
  if p_key is not null then
    insert into plot.r2_objects as o (key, job_id, bytes)
    values (p_key, p_job_id, coalesce(p_bytes, 0))
    on conflict (key) do update set bytes = excluded.bytes, job_id = excluded.job_id;
  end if;
  return true;
end;
$$;
revoke all on function public.plot_r2_reserve(text, uuid, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.plot_r2_reserve(text, uuid, bigint, bigint, bigint) to service_role;

-- 5. The upload landed: point the job at it, hand back the keys it replaces ---
create or replace function public.plot_r2_commit(p_job_id uuid, p_key text, p_bytes bigint)
returns setof text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update plot.r2_objects set committed = true, bytes = coalesce(p_bytes, bytes)
   where key = p_key and job_id = p_job_id;
  if not found then
    raise exception 'plot_r2_commit: no reservation for that file';
  end if;
  update plot.jobs set file_key = p_key, file_bytes = p_bytes where id = p_job_id;
  return query
    delete from plot.r2_objects
     where job_id = p_job_id and key <> p_key
       and (committed or created_at < now() - interval '1 day')
    returning key;
end;
$$;
revoke all on function public.plot_r2_commit(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.plot_r2_commit(uuid, text, bigint) to service_role;

-- 6. plot_list_jobs gains the file's size ------------------------------------
drop function if exists public.plot_list_jobs();
create function public.plot_list_jobs()
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
  file_bytes bigint,
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
         j.saved_at, j.file_key, j.file_bytes, j.created_by, j.updated_by, j.created_at, j.updated_at
    from plot.jobs j
   where j.removed_at is null
   order by j.updated_at desc;
$$;
revoke all on function public.plot_list_jobs() from public, anon;
grant execute on function public.plot_list_jobs() to authenticated;
