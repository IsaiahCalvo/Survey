-- Flag: lock Pro features for the Free plan. When on, Free plan users who
-- click Excel export / sync, regions, survey tools or OneDrive get a short
-- prompt instead (the native apps never show an upgrade link). Off for
-- everyone until paid plans go live. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('pro-lock', 'off', 'Lock Pro features for Free plan: Excel, regions, survey tools and OneDrive need a paid plan.')
on conflict (key) do nothing;
