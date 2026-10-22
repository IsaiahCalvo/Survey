-- Flag: make-your-own checklist answers in the template editor (1 to 6
-- answers, each Good / Problem / Neutral) plus more ready-made lists.
-- A beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('custom-answers', 'off', 'Templates: type your own checklist answers (1 to 6, each Good / Problem / Neutral) and more ready-made lists (Y/N, Done, Small/Medium/Large, Score 1-5).')
on conflict (key) do nothing;
