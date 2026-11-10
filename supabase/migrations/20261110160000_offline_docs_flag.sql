-- Flag: "Available offline" documents (Drawboard file model, 2026-11-10).
-- A document the user switches on is kept on the device and opens with no
-- signal; marks made meanwhile sync when it is back online. A beta flag, so
-- only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('offline-docs', 'off', 'Available offline: keep a document on this device so it opens with no signal.')
on conflict (key) do nothing;
