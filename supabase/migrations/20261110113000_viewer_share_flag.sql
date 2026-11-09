-- Nightly beta: share from inside a document (Drawboard PDF Pro trial audit 2026-11-09).
insert into public.feature_flags (key, mode, description)
values ('viewer-share', 'off', 'Share from inside a document: a Share button in the viewer top bar')
on conflict (key) do nothing;
