-- Nightly flag 'thin-lines' (Drawboard Projects parity: Enhance thin PDF
-- lines): a rail button with Off / Thin / Medium / Thick that darkens and
-- widens faint drawing lines on screen only (never the PDF or an export).
-- Beta, so only Survey Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('thin-lines', 'off', 'Viewer: Thin PDF lines button makes faint drawing lines easier to see on screen')
ON CONFLICT (key) DO NOTHING;
