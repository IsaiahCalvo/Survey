-- Flag: after the file pick, one card shows each PDF's name, sheet number
-- and revision (read from its title block or file name) to fix before it
-- uploads, from the Drawboard Projects round 2 audit (2026-11-10). A beta
-- flag, so only Survey Nightly shows it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('upload-check', 'off', 'Upload check: name, sheet number, revision before upload.')
on conflict (key) do nothing;
