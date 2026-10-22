-- Flag: download the survey as a PowerPoint report (cover, progress chart per
-- category, issues table). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('survey-report', 'off', 'Survey: download a PowerPoint report with a cover, a progress chart per category and the items with issues.')
on conflict (key) do nothing;
