-- Flag: Tape. Drawboard PDF's Tape tool: a freehand opaque pastel band that
-- covers part of the page; a tap under Pan shows it as an outline so what is
-- under it shows, another tap covers it again (2026-11-10). A beta flag, so
-- only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('tape-tool', 'off', 'Tape: an opaque band that covers part of the page; tap it under Pan to see what is under it.')
on conflict (key) do nothing;
