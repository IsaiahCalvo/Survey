-- Nightly flag tool-style-preview (Drawboard PDF Pro push, 2026-11-12): the
-- desktop colour popover shows a live preview of what the tool will draw.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('tool-style-preview', 'off', 'Desktop colour popover: live preview of what the tool will draw.')
ON CONFLICT (key) DO NOTHING;
