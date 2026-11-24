-- Flag: a tapped Survey Marker's quick bar shows its Category, Tag and
-- checklist items, and Expand opens the Survey panel on it (owner
-- 2026-11-24). A beta flag, so only Survey Nightly shows it. Keep in step
-- with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('marker-tap-card', 'off', 'Marker tap card: Category, Tag and checklist items on a tapped Survey Marker.')
on conflict (key) do nothing;
