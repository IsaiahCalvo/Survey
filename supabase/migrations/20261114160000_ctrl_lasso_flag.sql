-- Nightly flag for Drawboard PDF Pro's Ctrl+drag lasso under Select
-- (checked against the Drawboard web app 2026-11-14). Beta, so only Survey
-- Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('ctrl-lasso', 'off', 'Select: Ctrl+drag (Cmd+drag on a Mac) on the page draws a lasso instead of a box.')
ON CONFLICT (key) DO NOTHING;
