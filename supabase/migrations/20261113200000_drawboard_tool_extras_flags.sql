-- Nightly flags for the last Drawboard PDF Pro tool extras (owner 2026-11-13:
-- "nothing can be missing"). Beta flags, so only Survey Nightly shows them;
-- the rows start off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('text-review-remove', 'off', 'Remove text marks tool: drag over words and their highlight, underline, squiggle and strike-through come off.'),
  ('image-camera', 'off', 'Camera on Image: take a photo with the camera and drop it on the page.'),
  ('ruler-tool', 'off', 'Ruler: a straight edge you move and turn on the page; pen lines drawn along it come out straight.')
ON CONFLICT (key) DO NOTHING;
