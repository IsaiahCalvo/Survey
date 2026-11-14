-- OneDrive and SharePoint change a file's eTag on a rename, a move or a
-- column edit, not only when its content changes; the cTag changes only with
-- the content. Survey keeps both, so a renamed PDF is no false conflict
-- (supabase/functions/_shared/driveFiles/service.js). Server only, like etag.
alter table public.document_drive_links add column if not exists ctag text;
