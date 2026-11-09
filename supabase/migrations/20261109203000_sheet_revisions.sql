-- Sheet revisions (Nightly flag 'sheet-revisions', Drawboard Projects trial
-- audit 2026-11-09): the sheet number and revision read from a drawing's
-- title block when it is uploaded. An upload whose sheet number matches an
-- open document in the same place is offered as that sheet's new version.
-- Both are plain labels the owner's own client writes; nothing trusts them.
alter table public.documents
  add column if not exists sheet_number text,
  add column if not exists sheet_revision text;

alter table public.documents
  drop constraint if exists documents_sheet_number_len,
  add constraint documents_sheet_number_len check (sheet_number is null or char_length(sheet_number) <= 40),
  drop constraint if exists documents_sheet_revision_len,
  add constraint documents_sheet_revision_len check (sheet_revision is null or char_length(sheet_revision) <= 12);

create index if not exists documents_user_sheet_number_idx
  on public.documents (user_id, sheet_number)
  where sheet_number is not null;

-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('sheet-revisions', 'off', 'Sheet revisions: read the title block on upload and offer a new version.')
on conflict (key) do nothing;
