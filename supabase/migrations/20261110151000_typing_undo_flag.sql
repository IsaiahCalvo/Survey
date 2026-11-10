-- Flag: Undo while typing in a text box or callout steps back one word (or a
-- run of deletes, or a pause) at a time, as Drawboard does, instead of the
-- browser's one step for the whole typing session (t2-tools-deep.md gap 3).
-- A beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('typing-undo', 'off', 'Undo while typing goes back one word at a time.')
on conflict (key) do nothing;
