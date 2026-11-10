-- Home > New: Notebook paper in one tap and Other templates (Nightly flag
-- home-templates, Drawboard PDF's + menu > Create). Made in the browser; no
-- tables.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('home-templates', 'off', 'Home New menu: Notebook paper in one tap and Other templates (ruled, Cornell, grids, graph, isometric, hex, music).')
ON CONFLICT (key) DO NOTHING;
