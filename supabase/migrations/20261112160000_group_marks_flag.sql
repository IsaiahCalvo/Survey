-- Nightly flag group-marks (Drawboard PDF Pro push, 2026-11-12): Group and
-- Ungroup in the mark right-click menu; a click on any member picks them all.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('group-marks', 'off', 'Mark menu: Group / Ungroup picked marks.')
ON CONFLICT (key) DO NOTHING;
