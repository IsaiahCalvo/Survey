-- Nightly flag 'author-chip' (Drawboard Projects parity SS-03 / SS-04): the
-- picked marks' quick bar names who made them and opens a table of the pick
-- by author, with each mark's date and layer. Beta, so only Survey Nightly
-- shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('author-chip', 'off', 'Selection bar: who made the picked marks, with a table by author (date, layer)')
ON CONFLICT (key) DO NOTHING;
