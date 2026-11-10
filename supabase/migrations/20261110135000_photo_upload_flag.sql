-- Flag: Upload (and dropping files on the list) takes photos too; each photo
-- or camera shot becomes a one-page PDF, from the Drawboard phone-app study
-- (2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('photo-upload', 'off', 'Photo or camera: Upload turns photos into one-page PDFs.')
on conflict (key) do nothing;
