-- Flag: Edit measurement. A drawn measurement's name (shown in front of its
-- value), depth (Wall area and Volume) and caption on or off change later
-- from its right-click menu, like Drawboard's measurement properties
-- (2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('measure-edit', 'off', 'Edit measurement: change a drawn measurement''s name, depth and caption.')
on conflict (key) do nothing;
