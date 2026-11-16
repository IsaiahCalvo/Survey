-- Flag: the bar over a picked mark goes by its kind (KAL-651, Drawboard's
-- bar as recorded 2026-11-16). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('mark-bar-by-kind', 'off', 'The bar over a picked mark goes by its kind: fill, start and end, text size, bold and align.')
on conflict (key) do nothing;
