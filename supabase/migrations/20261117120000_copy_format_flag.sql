-- Nightly flag copy-format (KAL-718, Drawboard's More menu): Copy format and
-- Paste format in the mark right-click menu.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('copy-format', 'off', 'Mark menu: Copy format / Paste format.')
ON CONFLICT (key) DO NOTHING;
