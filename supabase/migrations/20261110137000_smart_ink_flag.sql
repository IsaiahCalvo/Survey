-- Flag: smart ink. Resting the pen for half a second at the end of a stroke
-- snaps it to a straight line, rectangle or ellipse (the highlighter only
-- straightens), like Drawboard's hold to straighten (2026-11-10). A beta flag,
-- so only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('smart-ink', 'off', 'Smart ink: hold at the end of a stroke to snap it to a shape.')
on conflict (key) do nothing;
