-- Nightly flag: one way to comment on a page. Page comment pins and page
-- threads were already one table (mark_comments, a pin is a page thread with
-- a spot); this flag makes the Comments panel's + place a pin instead of
-- starting a thread with no spot. Beta, so only Survey Nightly shows it; the
-- row starts off. No data changes.
INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('page-comments-one', 'off', 'Comments: the Comments panel + places a Page comment pin; pin threads open their card')
ON CONFLICT (key) DO NOTHING;
