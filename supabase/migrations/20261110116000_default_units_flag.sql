-- Nightly beta: a default units setting (Drawboard PDF Pro trial audit 2026-11-09).
insert into public.feature_flags (key, mode, description)
values ('default-units', 'off', 'Default units setting: imperial or metric for page scale and new documents')
on conflict (key) do nothing;
