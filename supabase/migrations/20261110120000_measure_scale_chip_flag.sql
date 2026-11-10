-- Nightly beta: "No scale on this page" chip while measuring (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('measure-scale-chip', 'off', 'Show a chip with Set scale while a measure tool is armed on a page with no scale')
on conflict (key) do nothing;
