-- Flag: more measure tools from the Drawboard Projects trial audit
-- (2026-11-09): Polylength, Wall area (outline x depth) and Volume
-- (area x depth). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('measure-depth', 'off', 'Measure: Polylength, Wall area and Volume.')
on conflict (key) do nothing;
