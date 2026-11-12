-- Flag: with a mark picked, Ctrl / Cmd + Left / Right turn it 1° (5° with
-- Shift) and Ctrl / Cmd + Up / Down scale it 10%, as in Drawboard Projects
-- (KS-01 / KS-02). A beta flag, so only Survey Nightly shows it. Keep in
-- step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('turn-scale-keys', 'off', 'Keys: Ctrl / Cmd + arrows turn and scale the picked mark.')
on conflict (key) do nothing;
