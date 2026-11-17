-- Nightly flag flip-marks (KAL-723, Drawboard's Flip): Flip horizontal /
-- vertical on the mark menu mirrors the pick as one piece.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('flip-marks', 'off', 'Flip horizontal / vertical on the mark menu.')
ON CONFLICT (key) DO NOTHING;
