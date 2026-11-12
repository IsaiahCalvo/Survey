-- Flag: open a PDF with no account (Drawboard file model, 2026-11-10).
-- Signed out, a PDF opens and stays on this device (browser storage) with its
-- marks, until the person saves it to an account. A beta flag, so only Survey
-- Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('device-files', 'off', 'Open a PDF with no account (kept on this device).')
on conflict (key) do nothing;
