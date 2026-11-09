-- Flag: the browser back gesture and the Android back button close the open
-- sheet, then the document, instead of leaving Survey (Drawboard PDF Pro
-- trial audit, 2026-11-09). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('back-button', 'off', 'Back closes the open sheet, then the document, instead of leaving Survey.')
on conflict (key) do nothing;
