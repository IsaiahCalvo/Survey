-- Nightly flag markup-group-by (KAL-724): group the Markups list by kind,
-- page (Drawboard's way) or person.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('markup-group-by', 'off', 'Group the Markups list by kind, page or person.')
ON CONFLICT (key) DO NOTHING;
