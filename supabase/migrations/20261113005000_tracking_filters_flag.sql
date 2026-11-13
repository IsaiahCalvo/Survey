-- Survey list chips (Nightly flag 'tracking-filters', owner 2026-11-12):
-- Assigned to me / Due soon / Late / Hide done stay on Nightly until they
-- look right. Client only. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description)
values ('tracking-filters', 'off', 'Survey list chips: Assigned to me, Due soon, Late, Hide done')
on conflict (key) do nothing;
