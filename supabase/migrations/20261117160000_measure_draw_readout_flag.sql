-- Nightly flag measure-draw-readout: the length and angle beside the pointer
-- while a Length is drawn (Drawboard's live "4in · 0°" chip).
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('measure-draw-readout', 'off', 'Length and angle beside the pointer while drawing a Length.')
ON CONFLICT (key) DO NOTHING;
