-- Nightly flag survey-agent-device-voice: the Survey agent's replies can be
-- spoken by Kyutai Pocket TTS on the device (downloads ~146 MB once, when
-- the person picks it) instead of the cloud voice.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('survey-agent-device-voice', 'off', 'Survey agent: choose an on-device voice (Pocket TTS).')
ON CONFLICT (key) DO NOTHING;
