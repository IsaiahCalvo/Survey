-- Nightly flag text-highlight-tool (Drawboard PDF Pro push, 2026-11-12): the
-- Text group's Highlight text paints the band as you drag and highlights the
-- words when you let go.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('text-highlight-tool', 'off', 'Highlight text: the band follows the pointer as you drag, letting go highlights the words.')
ON CONFLICT (key) DO NOTHING;
