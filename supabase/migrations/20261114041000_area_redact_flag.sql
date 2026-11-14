-- Nightly flag for Drawboard's area Redaction tool (owner 2026-11-13:
-- "nothing can be missing"). Beta, so only Survey Nightly shows it; the row
-- starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('area-redact', 'off', 'Redact area: drag a box over any part of a page and it is blacked out (Apply redactions makes the redacted copy).')
ON CONFLICT (key) DO NOTHING;
