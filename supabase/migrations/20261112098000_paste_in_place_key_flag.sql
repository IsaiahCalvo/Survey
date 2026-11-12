-- Nightly flag paste-in-place-key (Drawboard PDF Pro push, 2026-11-12):
-- Ctrl+Shift+V pastes the copied marks at their original spot.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('paste-in-place-key', 'off', 'Ctrl+Shift+V: paste the copied marks in place.')
ON CONFLICT (key) DO NOTHING;
