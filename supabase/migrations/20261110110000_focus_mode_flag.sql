-- Flag: focus mode hides the tab strip and side rails and goes full screen
-- (Drawboard PDF Pro trial audit, 2026-11-09). A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('focus-mode', 'off', 'Focus mode: hide the tab strip and side rails, full screen.')
on conflict (key) do nothing;
