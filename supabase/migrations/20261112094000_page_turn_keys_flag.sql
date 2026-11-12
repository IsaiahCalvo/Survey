-- Nightly flag page-turn-keys (Drawboard PDF Pro push, 2026-11-12): with
-- nothing picked, Left / Right and Shift + Up / Down turn the page.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('page-turn-keys', 'off', 'Keys: with nothing picked, Left / Right and Shift + Up / Down turn the page.')
ON CONFLICT (key) DO NOTHING;
