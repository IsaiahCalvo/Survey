-- Flag: Alt+Shift+] / [ steps through the open documents (Drawboard PDF Pro
-- trial audit, 2026-11-09). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('tab-keys', 'off', 'Alt+Shift+] / [ steps through the open documents.')
on conflict (key) do nothing;
