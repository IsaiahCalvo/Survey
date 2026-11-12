-- Google Drive files that save back, next to OneDrive (Drawboard file model,
-- 2026-11-12; supabase/functions/_shared/driveFiles/service.js). A Google
-- Drive link stores drive_id 'google' and the file id as item_id; etag holds
-- the file's head revision, which a push checks before it writes.
alter table public.document_drive_links drop constraint if exists document_drive_links_provider_check;
alter table public.document_drive_links
  add constraint document_drive_links_provider_check check (provider in ('msgraph', 'google'));
