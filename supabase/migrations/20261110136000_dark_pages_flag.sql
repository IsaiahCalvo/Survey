-- Flag: a "Dark pages" switch (desktop rail, phone zoom menu) shows PDF pages
-- light-on-dark for night work or site glare, from the Drawboard phone-app
-- study (2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in
-- step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('dark-pages', 'off', 'Dark pages: PDF pages light-on-dark; marks keep their colours.')
on conflict (key) do nothing;
