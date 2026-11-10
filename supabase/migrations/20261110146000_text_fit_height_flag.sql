-- Flag: a text box widened from its side fits its words both ways, as in
-- Drawboard PDF Pro (trial 2026-11-10, t2-tools-deep.md bug 4). A beta flag,
-- so only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('text-fit-height', 'off', 'Text box height fits its words both ways on a side drag.')
on conflict (key) do nothing;
