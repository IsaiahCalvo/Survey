-- Nightly beta: keys shown on the mark right-click menu (Drawboard PDF Pro trial audit 2026-11-09).
insert into public.feature_flags (key, mode, description)
values ('menu-keys', 'off', 'Keys shown on the mark right-click menu rows')
on conflict (key) do nothing;
