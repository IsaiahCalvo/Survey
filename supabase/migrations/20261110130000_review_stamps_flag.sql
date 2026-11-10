-- Flag: ready-made review stamps (Approved, Rejected, For construction ...)
-- in the Library panel's Stamps tab, from the Drawboard Projects round 2
-- audit (2026-11-10). A beta flag, so only Survey Nightly shows it. Keep in
-- step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('review-stamps', 'off', 'Review stamps in the Library panel.')
on conflict (key) do nothing;
