-- Flag: Drawboard's three pens - Basic (fixed width), Pro (width from pen
-- pressure or mouse speed) and Calligraphy (width from the direction of
-- travel), measured live 2026-11-10 (endings-and-pens.md). A beta flag, so
-- only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('pen-types', 'off', 'Pen types: Basic, Pro and Calligraphy pens.')
on conflict (key) do nothing;
