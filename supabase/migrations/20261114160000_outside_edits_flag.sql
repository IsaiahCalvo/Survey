-- Nightly flag `outside-edits` (keep in step with src/featureFlags.js): when a
-- PDF exported from Survey is changed in Adobe Acrobat (or another PDF app)
-- and uploaded as a new version, marks changed or deleted there since the
-- export come across, where Survey's copy is unchanged since that export.
-- Beta, so only Survey Nightly shows it; the row starts off. No schema change.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('outside-edits', 'off', 'Upload as new version: marks changed or deleted in Adobe since export come across.')
ON CONFLICT (key) DO NOTHING;
