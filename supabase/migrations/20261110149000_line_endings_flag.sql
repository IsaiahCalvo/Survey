-- Flag: Drawboard's Endings for the Line and Arrow tools - a Start | End
-- switch over all ten PDF line endings, drawn at Drawboard's measured sizes
-- (checked live 2026-11-10, endings-and-pens.md). A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('line-endings', 'off', 'Line endings: ten heads for the start and end of a Line or Arrow.')
on conflict (key) do nothing;
