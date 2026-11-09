-- Flag: Backspace or Undo while placing a polygon or polyline takes the last
-- point off (Drawboard PDF Pro trial audit, 2026-11-09). A beta flag, so only
-- Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('poly-back-step', 'off', 'Backspace or Undo while placing a polygon or polyline takes the last point off.')
on conflict (key) do nothing;
