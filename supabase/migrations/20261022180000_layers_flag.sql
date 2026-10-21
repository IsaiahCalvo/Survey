-- Flag: the Layers panel (markup layers with show/hide and an active layer,
-- plus PDF content opacity). Off for everyone until the coordinator turns it
-- on. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('layers', 'off', 'Layers panel: markup layers (add, rename, hide, delete, active layer) and PDF content opacity.')
on conflict (key) do nothing;
