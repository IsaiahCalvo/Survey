-- Nightly flag selection-count (Drawboard PDF Pro push, 2026-11-12): the
-- selection bar shows how many marks a multi-pick holds.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('selection-count', 'off', 'Selection bar: count of marks in a multi-pick.')
ON CONFLICT (key) DO NOTHING;
