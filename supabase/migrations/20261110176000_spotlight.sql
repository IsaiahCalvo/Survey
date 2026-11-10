-- Spotlight (Nightly flag spotlight, Drawboard Projects' "Spotlight me"):
-- the presenter's view and who follows it travel on the document's existing
-- private live channel. No tables.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('spotlight', 'off', 'Spotlight: share your view from the people list; others follow your document, page and zoom.')
ON CONFLICT (key) DO NOTHING;
