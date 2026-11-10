-- Nightly beta: Alt+Shift+L / P / A (and Q / V) pick a measure tool (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('measure-keys', 'off', 'Alt+Shift+L / P / A (and Q / V) pick a measure tool')
on conflict (key) do nothing;
