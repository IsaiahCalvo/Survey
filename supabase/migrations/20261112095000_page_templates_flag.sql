-- Nightly flag page-templates (Drawboard PDF Pro push, 2026-11-12): the page
-- right-click gains Template page below, a new page drawn with a paper
-- template (notebook, Cornell, grids, isometric, music).
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('page-templates', 'off', 'Page right-click: Template page below, with a paper template.')
ON CONFLICT (key) DO NOTHING;
