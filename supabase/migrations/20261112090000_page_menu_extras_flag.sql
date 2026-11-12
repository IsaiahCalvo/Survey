-- Nightly flag page-menu-extras (Drawboard PDF Pro push, 2026-11-12): the
-- page right-click gains Move page up / down, Unlock all, Select all text.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('page-menu-extras', 'off', 'Page right-click: Move page up / down, Unlock all, Select all text.')
ON CONFLICT (key) DO NOTHING;
