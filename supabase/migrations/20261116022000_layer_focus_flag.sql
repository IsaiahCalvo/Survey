-- Nightly flag 'layer-focus' (Drawboard Projects parity: Layers focus
-- mode): a switch in the Layers panel fades the marks on every layer but the
-- selected one, at 10-80%. View only, never saved. Beta, so only Survey
-- Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('layer-focus', 'off', 'Layers: Focus on selected layer fades the marks on other layers')
ON CONFLICT (key) DO NOTHING;
