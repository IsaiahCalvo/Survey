-- Flag: Drawboard's measure formats. A page scale may carry a display
-- (feet-inches, fractional inches or a decimal unit) and a precision; the Set
-- page scale dialog adds a custom paper-to-real scale and "Set as default".
-- A beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('measure-plus', 'off', 'Measure formats: feet-inches readings, precision, custom scales and a default scale.')
on conflict (key) do nothing;
