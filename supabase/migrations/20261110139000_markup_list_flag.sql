-- Flag: Markups panel. Every mark on the document in one list in the left
-- rail, with search, filters (type, who, layer, measurements only),
-- measurement totals and a CSV, like Drawboard's markup list (2026-11-10).
-- A beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('markup-list', 'off', 'Markups panel: every mark in one list with search, filters, totals and a CSV.')
on conflict (key) do nothing;
