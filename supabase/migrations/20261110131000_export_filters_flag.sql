-- Flag: Export PDF keeps only some people's marks or some layers and can add
-- the document's comments as a CSV, from the Drawboard Projects round 2
-- audit (2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in
-- step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('export-filters', 'off', 'Export filters: authors, layers, comments CSV.')
on conflict (key) do nothing;
