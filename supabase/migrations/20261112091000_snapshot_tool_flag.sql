-- Nightly flag snapshot-tool (Drawboard PDF Pro push, 2026-11-12): drag an
-- area of a page and it is copied to the clipboard as a picture.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('snapshot-tool', 'off', 'Snapshot tool: drag an area of a page, it is copied as a picture.')
ON CONFLICT (key) DO NOTHING;
