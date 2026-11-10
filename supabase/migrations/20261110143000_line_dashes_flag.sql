-- Flag: Long dash and Dash-dot line styles (Drawboard PDF's five patterns,
-- 2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('line-dashes', 'off', 'Line styles: Long dash and Dash-dot.')
on conflict (key) do nothing;
