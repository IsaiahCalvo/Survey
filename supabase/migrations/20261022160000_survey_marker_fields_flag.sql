-- Flag: store each Survey Marker in the annotation doc as a nested Y.Map (one
-- entry per field) so two screens editing different fields of one marker at
-- once both keep their edit. Readers accept both shapes either way. Off for
-- everyone until the coordinator turns it on. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('survey-marker-fields', 'off', 'Survey markers: one Y.Map entry per field so concurrent field edits merge.')
on conflict (key) do nothing;
