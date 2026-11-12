-- Flag: with a mark picked, Polygon / Polyline's first click drops the pick
-- and places the first point, as in Drawboard PDF Pro (trial 2026-11-10,
-- t2-tools-deep.md bug 1). A beta flag, so only Survey Nightly shows it. Keep
-- in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('poly-click-starts', 'off', 'Polygon and Polyline: the first click with a mark picked places a point.')
on conflict (key) do nothing;
