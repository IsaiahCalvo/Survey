-- Nightly flag survey-agent-offline: with no signal, the Survey agent does the
-- common things said (answers by line, all lines, a note, show an item, undo)
-- on the device by plain rules, and hears with the device's offline speech.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('survey-agent-offline', 'off', 'Survey agent works with no signal: answers, notes and undo on the device.')
ON CONFLICT (key) DO NOTHING;
