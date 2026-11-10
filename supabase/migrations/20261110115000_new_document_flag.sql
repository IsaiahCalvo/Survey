-- Nightly beta: start a new blank document from Home (Drawboard PDF Pro trial audit 2026-11-09).
insert into public.feature_flags (key, mode, description)
values ('new-document', 'off', 'New blank document from Home (size, pages, lined, grid or dots)')
on conflict (key) do nothing;
