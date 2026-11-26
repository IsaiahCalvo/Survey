-- Nightly flag for the trackpad bounce at the page edges, done the way Safari
-- and Chrome do it on a Mac (owner 2026-11-25: "this should be some native
-- thing"). Beta, so only Survey Nightly shows it; the row starts off.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('native-bounce', 'off', 'Viewer: trackpad bounce at the page edges works like Safari and Chrome on a Mac')
ON CONFLICT (key) DO NOTHING;
