-- Nightly flag agent-template-offers (KAL-529): the Survey agent offers a
-- new checklist line or category on a Yes / No card, plus a note style
-- setting (sentences or bullets).
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('agent-template-offers', 'off', 'Survey agent offers a new checklist line or category, and a note style setting.')
ON CONFLICT (key) DO NOTHING;
