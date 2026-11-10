-- Flag: Drawboard's Hyperlink tool (Shift+H). Drag a box and link it to a
-- page, a website or an area; "Go to" on the picked bar follows it, and the
-- PDF export writes a real /Link. A beta flag, so only Survey Nightly shows
-- it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('link-tool', 'off', 'Hyperlink tool: drag a box and link it to a page, a website or an area.')
on conflict (key) do nothing;
