-- Flag: Export PDF choices (annotated, flattened or plain; all pages, this
-- page, pages with marks or a typed list). A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('export-modes', 'off', 'Export PDF choices: annotated, flattened or plain, and which pages.')
on conflict (key) do nothing;
