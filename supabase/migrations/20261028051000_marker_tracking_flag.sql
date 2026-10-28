-- Flag: survey item tracking (a status, who has it and a due date on each
-- survey item, with Assigned to me / Late / Hide done over the list). A beta
-- flag, so only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('marker-tracking', 'off', 'Survey items: status, assigned to and due date, with list filters.')
on conflict (key) do nothing;
