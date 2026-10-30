-- Flag: Curved polyline (the polyline bends smoothly through every clicked
-- corner, like the Takeoff freehand polyline). A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('spline-polyline', 'off', 'Curved polyline: bend smoothly through the clicked corners.')
on conflict (key) do nothing;
