-- Nightly flag 'toolbar-settings' (Drawboard Projects parity VT-52): the mark
-- menu's "Dock bar to bottom" / "Float bar by mark" for the picked marks'
-- quick bar, remembered per browser. Beta, so only Survey Nightly shows it;
-- the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('toolbar-settings', 'off', 'Selection bar: Dock bar to bottom / Float bar by mark (mark menu), remembered')
ON CONFLICT (key) DO NOTHING;
