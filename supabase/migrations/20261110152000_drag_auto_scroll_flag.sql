-- Flag: drawing a shape, moving a mark or box selecting with the pointer held
-- near the edge of the document view scrolls the view, as Drawboard does
-- (t2-tools-deep.md gap 8). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('drag-auto-scroll', 'off', 'Drags near the view edge scroll the view.')
on conflict (key) do nothing;
