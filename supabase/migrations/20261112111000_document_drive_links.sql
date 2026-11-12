-- OneDrive files that save back (Drawboard file model, 2026-11-10;
-- drive-sync-back-plan.md). A PDF opened from OneDrive or SharePoint keeps a
-- link to its drive file, and the app writes the marked-up PDF back on a
-- timer or on "Sync to OneDrive now", through the sheet-sync function's
-- Microsoft sign-in (supabase/functions/_shared/driveFiles/service.js).
--
-- 1. The beta flag (Survey Nightly only). Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('drive-sync-back', 'off', 'Open PDFs from OneDrive and save the marked-up PDF back to OneDrive.')
on conflict (key) do nothing;

-- 2. One drive file per Survey document. Everyone who can open the document
--    may read its link (the app shows "Saves back to OneDrive"); only the
--    function writes. The drive and item ids stay server side.
create table if not exists public.document_drive_links (
  document_id uuid primary key references public.documents (id) on delete cascade,
  provider text not null default 'msgraph' check (provider in ('msgraph')),
  drive_id text not null,
  item_id text not null,
  name text,
  web_url text,
  -- The drive file's version Survey last saw; a push sends it as If-Match, so
  -- a change made in OneDrive since is a conflict, never overwritten quietly.
  etag text,
  -- Whose Microsoft sign-in the server uses to reach the file.
  linked_by uuid references auth.users (id) on delete set null,
  sync_minutes integer not null default 5 check (sync_minutes between 1 and 1440),
  sync_off boolean not null default false,
  last_pushed_at timestamptz,
  last_pushed_sha text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.document_drive_links enable row level security;
revoke all on public.document_drive_links from anon, authenticated;
grant select (document_id, provider, name, web_url, linked_by, sync_minutes, sync_off, last_pushed_at, last_error, created_at, updated_at)
  on public.document_drive_links to authenticated;

drop policy if exists "Document readers see its drive link" on public.document_drive_links;
create policy "Document readers see its drive link"
  on public.document_drive_links for select to authenticated
  using (public.user_can_access_document(document_id, 'viewer'));
