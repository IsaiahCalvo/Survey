-- Drawboard keys (Nightly flag drawboard-keys): Shift+Up / Down previous /
-- next page, Alt+O / Alt+U next / previous version. No tables.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('drawboard-keys', 'off', 'Drawboard keys: Shift+Up / Down previous / next page; Alt+O / Alt+U next / previous version.')
ON CONFLICT (key) DO NOTHING;
