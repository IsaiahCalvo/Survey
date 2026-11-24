-- Nightly flags for the suite-alike viewer chrome. Beta, so only Survey
-- Nightly shows them; the rows start off.
--   'view-strip': one View button on the right rail opens a strip with Page
--     fit, Paper, Thin PDF lines, Grid, Dark pages and Full screen, so the
--     rail is short again.
--   'share-export-one': Share and Export become one Share button at the top
--     right, as in Walkthru, with Export inside it.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('view-strip', 'off', 'Viewer: one View button opens the page view tools in a strip beside the rail'),
  ('share-export-one', 'off', 'Viewer: one Share button at the top right, with Export inside it')
ON CONFLICT (key) DO NOTHING;
