-- Flag: the Text group's Image button and a pasted picture put an image on
-- the page as a mark that moves, resizes and rotates, and exports as a PDF
-- Stamp annotation, as in Drawboard (t2-tools-deep.md gap 4). A beta flag, so
-- only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('insert-image', 'off', 'Image: put a picture on the page as a mark.')
on conflict (key) do nothing;
