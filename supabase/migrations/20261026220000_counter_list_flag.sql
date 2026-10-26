-- Flag: the counts list under the counter tool (rename, continue, start new,
-- drag to reorder, and each count's pin and number colour, in one list). A
-- beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('counter-list', 'off', 'Counts list: rename, continue, reorder and recolour counter counts in one list.')
on conflict (key) do nothing;
