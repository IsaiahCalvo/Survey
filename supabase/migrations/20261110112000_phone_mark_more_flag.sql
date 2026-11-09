-- Flag: on a phone, a More button on the picked-mark bar opens the full mark
-- menu (Drawboard PDF Pro trial audit, 2026-11-09). A beta flag, so only
-- Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('phone-mark-more', 'off', 'Phone: a More button on the picked-mark bar opens the full mark menu.')
on conflict (key) do nothing;
