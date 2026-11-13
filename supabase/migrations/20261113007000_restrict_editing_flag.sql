-- Flag: Restrict editing on export (beta, Survey Nightly only; Drawboard
-- Projects parity EX-09). Keep in step with src/featureFlags.js.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('restrict-editing', 'off', 'Restrict editing: export a PDF that opens freely but needs a password to change or mark up')
ON CONFLICT (key) DO NOTHING;
