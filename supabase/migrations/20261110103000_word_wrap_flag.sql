-- Flag: new text boxes and callouts wrap at spaces, not mid-word (Drawboard
-- PDF Pro trial audit, 2026-11-09). A beta flag, so only Survey Nightly shows
-- it. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('word-wrap', 'off', 'New text boxes and callouts wrap at spaces.')
on conflict (key) do nothing;
