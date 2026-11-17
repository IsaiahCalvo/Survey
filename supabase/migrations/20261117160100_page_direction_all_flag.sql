-- Nightly flag page-direction-all: Horizontal for Double, Cover and Grid
-- (Drawboard's View settings): pairs and Grid columns run left to right.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('page-direction-all', 'off', 'Horizontal for Double, Cover and Grid: pages stack in columns that run left to right.')
ON CONFLICT (key) DO NOTHING;
