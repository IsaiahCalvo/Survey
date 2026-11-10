-- Flag: Drawboard Projects' Stamp tool with its twelve preset stamps (checked
-- live 2026-11-10, stamps-and-captions.md). A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('stamp-tool', 'off', 'Stamp tool: twelve preset stamps, pick one and click the page.')
on conflict (key) do nothing;
