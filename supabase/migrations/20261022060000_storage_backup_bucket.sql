-- Backups of stored files (PDFs, survey photos/video/audio, brand art).
--
-- Supabase's daily database backups do not include Storage. The weekly
-- storage-backup workflow (scripts/storage-backup.mjs, switched off until the
-- repo variable STORAGE_BACKUP_ENABLED is 'true') copies every object into
-- this private bucket as <source bucket>/<path>, server side, so no file leaves
-- Supabase and nothing is billed for egress. A file removed from its bucket
-- moves to _removed/<date>/... and is purged after 30 days, so a deleted
-- account's files leave the backup within about five weeks.
--
-- No storage policies: only the service role reads or writes it. Paths start
-- with the source bucket name, so the per-user rules that key on the first
-- folder (quota, account deletion, export) never match a backup copy.

insert into storage.buckets (id, name, public)
values ('storage-backup', 'storage-backup', false)
on conflict (id) do update set public = false;

-- What the backup compares: every object's size and last change, all buckets.
create or replace function public.storage_backup_inventory()
returns table (bucket_id text, name text, size bigint, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  return query
  select o.bucket_id, o.name, (o.metadata->>'size')::bigint, coalesce(o.updated_at, o.created_at)
  from storage.objects o
  where o.name is not null
    and o.name not like '%/.emptyFolderPlaceholder'
  order by o.bucket_id, o.name;
end;
$$;

revoke all on function public.storage_backup_inventory() from public, anon, authenticated;
grant execute on function public.storage_backup_inventory() to service_role;
