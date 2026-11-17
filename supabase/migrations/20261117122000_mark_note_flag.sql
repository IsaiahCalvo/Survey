-- Nightly flag mark-note (KAL-721, Drawboard's Edit Note): a written note on
-- any mark, edited from the mark menu and the properties panel.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('mark-note', 'off', 'A note on any mark (Edit note).')
ON CONFLICT (key) DO NOTHING;
