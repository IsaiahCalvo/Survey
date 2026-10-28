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
