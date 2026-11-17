-- Nightly flag apply-to-pages (KAL-720, Drawboard's More menu): Apply to
-- pages in the mark right-click menu.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('apply-to-pages', 'off', 'Mark menu: Apply to pages.')
ON CONFLICT (key) DO NOTHING;
