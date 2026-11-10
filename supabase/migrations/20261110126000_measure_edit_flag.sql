-- Nightly beta: edit a drawn measurement's label, depth, caption lines and caption size (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('measure-edit', 'off', 'Measure: a Measurement button on a picked measurement sets its label, depth, caption lines and caption size')
on conflict (key) do nothing;
