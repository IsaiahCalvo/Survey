-- Upload review (Nightly flag 'upload-review', Drawboard Projects parity
-- UP-10..23): the upload check as a review grid with title-block pictures,
-- discipline, bulk edits, Remove and one document per page. Client only;
-- the discipline saves through set_document_discipline (sheet register).
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description)
values ('upload-review', 'off', 'Upload review: title-block pictures, discipline, bulk edits, Remove, one document per page')
on conflict (key) do nothing;
