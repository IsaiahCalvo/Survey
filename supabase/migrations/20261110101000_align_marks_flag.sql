-- Flag: align and space picked marks from the mark menu (Drawboard PDF Pro
-- trial audit, 2026-11-09). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('align-marks', 'off', 'Align and space picked marks.')
on conflict (key) do nothing;
