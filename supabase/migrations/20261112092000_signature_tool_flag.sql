-- Nightly flag signature-tool (Drawboard PDF Pro push, 2026-11-12): draw or
-- type a signature, save it, and click the page to sign.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('signature-tool', 'off', 'Signature tool: draw or type a signature, save it, click the page to sign.')
ON CONFLICT (key) DO NOTHING;
