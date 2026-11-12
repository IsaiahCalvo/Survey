-- Export project (Nightly flag 'project-export', Drawboard Projects parity
-- EX-10 / EX-12 / EX-17): one zip of the whole project built on the device.
-- Client only: it reads files, marks, comments and issues with the person's
-- own access. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description)
values ('project-export', 'off', 'Export project: one zip of every file with marks or originals, all revisions, comments and issues CSVs')
on conflict (key) do nothing;
