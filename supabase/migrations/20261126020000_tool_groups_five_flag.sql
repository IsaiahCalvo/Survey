-- Nightly flag: the top tool bar in five groups, as Drawboard PDF (Draw,
-- Shapes, Text, Measure, Insert). Beta, so only Survey Nightly shows it; the
-- row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('tool-groups-five', 'off', 'Viewer: five tool groups in the top bar (Draw, Shapes, Text, Measure, Insert)')
ON CONFLICT (key) DO NOTHING;
