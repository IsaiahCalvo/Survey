-- Nightly beta: zoom to an area with Ctrl+Shift+drag (Drawboard PDF Pro trial audit 2026-11-09).
insert into public.feature_flags (key, mode, description)
values ('zoom-to-area', 'off', 'Zoom to an area: Ctrl+Shift+drag draws a box and the view fills with it')
on conflict (key) do nothing;
