-- Flag: the pinned tools dock (favourite tools, each with its own colour and
-- width, docked left, right or bottom of the page). A beta flag, so only
-- Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('pinned-tools', 'off', 'Pinned tools dock: pin favourite tools with their own colour and width, docked left, right or bottom.')
on conflict (key) do nothing;
