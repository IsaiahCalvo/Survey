-- Flag: copy marks in one document and paste them in another (Drawboard PDF
-- Pro trial audit, 2026-11-09). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('paste-across-documents', 'off', 'Copy marks in one document and paste them in another.')
on conflict (key) do nothing;
