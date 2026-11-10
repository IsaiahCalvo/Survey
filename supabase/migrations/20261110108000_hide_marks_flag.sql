-- Flag: hide all marks from the right rail, with a chip to bring them back
-- (Drawboard PDF Pro trial audit, 2026-11-09). A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('hide-marks', 'off', 'Hide all marks from the right rail, with a chip to bring them back.')
on conflict (key) do nothing;
