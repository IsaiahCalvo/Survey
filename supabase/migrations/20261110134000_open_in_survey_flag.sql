-- Flag: a PDF opened from Files, Mail, Outlook or Teams on a phone ("Open in
-- Survey") uploads and opens in the app, from the Drawboard phone-app study
-- (2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('open-in-survey', 'off', 'Open in Survey: PDFs opened from other phone apps upload and open.')
on conflict (key) do nothing;
