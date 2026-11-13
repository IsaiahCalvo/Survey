-- Nightly flags for the Drawboard PDF Pro tool check (owner 2026-11-13:
-- "nothing can be missing"). Each is a beta flag, so only Survey Nightly
-- shows it; the rows start off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('text-markup-tools', 'off', 'Underline, Squiggle, Strikethrough and Redact text tools: drag over words and letting go marks them.'),
  ('laser-pointer', 'off', 'Laser pointer: a glowing line that follows the pen or mouse and fades away; never saved.'),
  ('measure-angle', 'off', 'Angle measure: click three points, the corner in the middle, to read the angle in degrees.')
ON CONFLICT (key) DO NOTHING;
