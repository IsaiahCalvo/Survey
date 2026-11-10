-- Flag: Drawboard PDF's "Expand menu" properties panel (checked live
-- 2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('properties-panel', 'off', 'Properties panel: typed X Y W H R, stroke, border and fill.')
on conflict (key) do nothing;
