-- Nightly flag for the Kal Voe suite work in Survey (KAL-584 spec, Isaiah's
-- go 2026-11-15): suite words on screen, the shared device id and Building /
-- Wing / Floor / Location on Survey Markers, and My library / Company
-- library. Beta, so only Survey Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('suite', 'off', 'Kal Voe suite: suite words, shared device id and places on Survey Markers, My library / Company library.')
ON CONFLICT (key) DO NOTHING;
