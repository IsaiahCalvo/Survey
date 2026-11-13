-- Nightly flag page-spreads (Drawboard PDF Pro push, 2026-11-12): Single,
-- Double and Cover page views in the Page fit card.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('page-spreads', 'off', 'Viewer: Double / Cover page views.')
ON CONFLICT (key) DO NOTHING;
