-- Nightly beta: download a document with its marks from Home (Drawboard PDF Pro trial audit 2026-11-09).
insert into public.feature_flags (key, mode, description)
values ('home-download', 'off', 'Download a document, with its marks, from the Home list')
on conflict (key) do nothing;
