-- Nightly beta: open builds the marks of the page on screen first, the pages around it once the device is idle (App speed thread 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('open-visible-first', 'off', 'Open: build the marks of the page on screen first, the pages around it after it has drawn')
on conflict (key) do nothing;
