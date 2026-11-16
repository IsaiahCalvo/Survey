-- Nightly flag 'one-look' (KAL-663, owner 2026-11-16): Survey takes the
-- suite's grey and coral colours, with a light and a dark mode, in place of
-- the blue-grey and blue. Beta, so only Survey Nightly shows it; the row
-- starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('one-look', 'off', 'Suite look: grey and coral, with light and dark mode')
ON CONFLICT (key) DO NOTHING;
