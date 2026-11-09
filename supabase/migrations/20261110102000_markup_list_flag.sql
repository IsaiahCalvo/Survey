-- Flag: the Markups list in the left rail (Drawboard Projects + PDF Pro trial
-- audit, 2026-11-09). A beta flag, so only Survey Nightly shows it.
-- Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('markup-list', 'off', 'Markups list in the left rail.')
on conflict (key) do nothing;
