-- Flag: page grid spacing (Fine, Normal, Wide, or a custom spacing in paper
-- units or drawing units that follow each page's scale). A beta flag, so only
-- Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('grid-settings', 'off', 'Page grid spacing: fine, normal, wide or custom, in paper or drawing units.')
on conflict (key) do nothing;
