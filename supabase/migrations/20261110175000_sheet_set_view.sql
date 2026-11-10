-- A project's sheets as one set (Nightly flag sheet-set-view, Drawboard
-- Projects' bottom-bar arrows, drawing picker, List and Grid views and Open
-- all). Reads the documents the app already loads; no tables.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('sheet-set-view', 'off', 'Project sheets as a set: previous / next sheet, sheet picker, Shift+Left / Right, List and Grid views, Open all.')
ON CONFLICT (key) DO NOTHING;
