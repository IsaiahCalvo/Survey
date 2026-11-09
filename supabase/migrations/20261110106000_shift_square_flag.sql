-- Flag: hold Shift while drawing a rectangle or ellipse for a square or
-- circle (Drawboard PDF Pro trial audit, 2026-11-09). A beta flag, so only
-- Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('shift-square', 'off', 'Hold Shift while drawing a rectangle or ellipse for a square or circle.')
on conflict (key) do nothing;
