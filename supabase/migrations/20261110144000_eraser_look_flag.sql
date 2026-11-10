-- Flag: Drawboard PDF's eraser look (cursor, trail, lit hits, icon mode
-- buttons; checked live 2026-11-10). A beta flag, so only Survey Nightly
-- shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('eraser-look', 'off', 'Eraser look: cursor, trail, lit hits, icon mode buttons.')
on conflict (key) do nothing;
