-- Flag: Match case and Whole word in the search panel (Drawboard PDF Pro
-- trial audit, 2026-11-09). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('search-options', 'off', 'Search: Match case and Whole word.')
on conflict (key) do nothing;
