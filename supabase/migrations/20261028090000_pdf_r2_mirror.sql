-- Serve stored PDFs from Cloudflare R2 (docs/PDF-R2.md).
--
-- Supabase Storage stays the home of every PDF and the only place uploads go.
-- The pdf-file-url edge function copies a PDF into R2 the first time it is
-- opened and hands out short-lived R2 links after the same access check the app
-- already makes, so repeat downloads stop costing Supabase egress.
--
-- 1. The rollout flag. Off: every open reads from Supabase as before.
insert into public.feature_flags (key, mode, description) values
  ('pdf-r2', 'off', 'Open PDFs from the Cloudflare R2 copy (falls back to Supabase Storage).')
on conflict (key) do nothing;

-- 2. R2 copies to remove. When a stored PDF is deleted or moved in the
-- documents bucket, its path lands here, and archive-purge-sweep deletes the
-- R2 copy on its daily run. A left-over copy is never served in the meantime:
-- pdf-file-url only signs a link after Storage says the caller may read the
-- path and that the copy is the current version. A page edit that rewrites a
-- PDF in place needs no entry; its new ETag no longer matches the copy's.
create table if not exists public.pdf_r2_deletes (
  path text primary key,
  queued_at timestamptz not null default now()
);

alter table public.pdf_r2_deletes enable row level security;
-- No policies: only the service role (the sweep) reads or clears it.
revoke all on public.pdf_r2_deletes from anon, authenticated;

comment on table public.pdf_r2_deletes is
  'Paths in the documents bucket whose Cloudflare R2 copy must be removed. Filled by a trigger on storage.objects; drained by archive-purge-sweep. service_role only.';

create or replace function public.queue_pdf_r2_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.bucket_id is distinct from 'documents' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.bucket_id is not distinct from old.bucket_id then
    return null;
  end if;
  insert into public.pdf_r2_deletes (path) values (old.name)
  on conflict (path) do update set queued_at = excluded.queued_at;
  return null;
end;
$$;

revoke all on function public.queue_pdf_r2_delete() from public, anon, authenticated;

comment on function public.queue_pdf_r2_delete() is
  'AFTER DELETE / UPDATE OF name trigger on storage.objects: queues the documents-bucket path in pdf_r2_deletes so its R2 copy is removed.';

drop trigger if exists queue_pdf_r2_delete on storage.objects;
create trigger queue_pdf_r2_delete
  after delete or update of name, bucket_id on storage.objects
  for each row execute function public.queue_pdf_r2_delete();

-- 3. Never past Cloudflare's free tier (owner, 2026-10-28). R2 bills
-- automatically past 10 GB stored, 1M Class A (writes, lists) and 10M Class B
-- (reads) operations a month, and has no spending cap of its own. So every R2
-- operation is reserved here first, and refused at 80% of each allowance; a
-- refusal makes pdf-file-url answer "use Supabase", which the app already
-- does on any other answer. Operations count over a rolling 31 days, so the
-- cap holds whatever day Cloudflare's billing month starts.
create table if not exists public.pdf_r2_copies (
  path text primary key,
  size bigint not null check (size >= 0),
  copied_at timestamptz not null default now()
);
alter table public.pdf_r2_copies enable row level security;
revoke all on public.pdf_r2_copies from anon, authenticated;
comment on table public.pdf_r2_copies is
  'Bytes each Cloudflare R2 copy holds (reserved before the copy is made). Their sum is checked against the free-tier cap by r2_reserve. service_role only.';

create table if not exists public.r2_usage_daily (
  day date primary key,
  class_a bigint not null default 0,
  class_b bigint not null default 0
);
alter table public.r2_usage_daily enable row level security;
revoke all on public.r2_usage_daily from anon, authenticated;
comment on table public.r2_usage_daily is
  'Cloudflare R2 operations Survey made (or, for the links it signs, at most caused) each UTC day. Read by r2_reserve and scripts/backend-alerts.mjs. service_role only.';

create or replace function public.r2_limits()
returns table (max_bytes bigint, max_class_a bigint, max_class_b bigint)
language sql
immutable
set search_path = ''
as $$
  -- 80% of the free tier: 10 GB (decimal, the smaller reading), 1M Class A, 10M Class B.
  select 8000000000::bigint, 800000::bigint, 8000000::bigint;
$$;

-- Reserves operations (and, with p_path, the bytes of that path's copy,
-- replacing any earlier size) if everything stays under the caps. Returns
-- false and records nothing otherwise.
create or replace function public.r2_reserve(
  p_class_a bigint,
  p_class_b bigint,
  p_path text default null,
  p_bytes bigint default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits record;
  v_a bigint;
  v_b bigint;
  v_bytes bigint;
  v_old bigint := 0;
  v_day date := (now() at time zone 'utc')::date;
begin
  if coalesce(p_class_a, 0) < 0 or coalesce(p_class_b, 0) < 0 or coalesce(p_bytes, 0) < 0 then
    raise exception 'r2_reserve: negative amounts';
  end if;
  -- One reservation at a time, so two copies cannot both squeeze under a cap.
  perform pg_advisory_xact_lock(hashtext('public.r2_reserve'));
  select * into v_limits from public.r2_limits();
  select coalesce(sum(class_a), 0), coalesce(sum(class_b), 0) into v_a, v_b
    from public.r2_usage_daily where day > v_day - 31;
  -- Bytes only matter when a copy is being made (opens just read).
  if p_path is not null then
    select coalesce(sum(size), 0) into v_bytes from public.pdf_r2_copies;
    select coalesce((select size from public.pdf_r2_copies where path = p_path), 0) into v_old;
  end if;
  if v_a + coalesce(p_class_a, 0) > v_limits.max_class_a
     or v_b + coalesce(p_class_b, 0) > v_limits.max_class_b
     or (p_path is not null and v_bytes - v_old + coalesce(p_bytes, 0) > v_limits.max_bytes) then
    return false;
  end if;
  insert into public.r2_usage_daily (day, class_a, class_b)
    values (v_day, coalesce(p_class_a, 0), coalesce(p_class_b, 0))
    on conflict (day) do update set
      class_a = public.r2_usage_daily.class_a + excluded.class_a,
      class_b = public.r2_usage_daily.class_b + excluded.class_b;
  if p_path is not null then
    insert into public.pdf_r2_copies (path, size) values (p_path, coalesce(p_bytes, 0))
      on conflict (path) do update set size = excluded.size, copied_at = now();
  end if;
  return true;
end;
$$;

revoke all on function public.r2_reserve(bigint, bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.r2_limits() from public, anon, authenticated;
grant execute on function public.r2_reserve(bigint, bigint, text, bigint) to service_role;
grant execute on function public.r2_limits() to service_role;

comment on function public.r2_reserve(bigint, bigint, text, bigint) is
  'Reserves Cloudflare R2 operations (and a copy''s bytes) under 80% of the free tier over a rolling 31 days; false = refused, nothing recorded. service_role only (pdf-file-url, scripts/r2-copy-pdfs.mjs).';
