-- Flag: the share and team pickers offer a Commenter role (owner
-- 2026-11-24). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('commenter-role', 'off', 'Commenter role: people can read, comment and reply, but not draw or answer.')
on conflict (key) do nothing;
