-- Flag: pages as records (Drawboard file model, 2026-11-10).
-- A move, delete, turn, copy or blank page saves a page list with the marks
-- instead of rewriting and uploading the PDF; the PDF is built only for
-- download, export, print and share. A beta flag, so only Survey Nightly
-- shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('page-records', 'off', 'Page changes never rewrite the PDF (pages as records).')
on conflict (key) do nothing;
