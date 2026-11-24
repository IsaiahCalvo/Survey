-- Nightly flag survey-mode-tools (owner 2026-11-23): survey tools in Survey
-- mode's pinned tools bar, and a Survey chip in the tool bar to see and leave
-- Survey mode.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('survey-mode-tools', 'off', 'Survey mode: survey tools in the pinned tools bar, and a Survey chip to see and leave Survey mode.')
ON CONFLICT (key) DO NOTHING;
