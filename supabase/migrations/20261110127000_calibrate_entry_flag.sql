-- Nightly beta: Calibrate takes feet-inches and shows the traced paper length (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('calibrate-entry', 'off', 'Calibrate takes feet-inches (20'' 6", 20-6) and shows the traced paper length')
on conflict (key) do nothing;
