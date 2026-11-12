-- Nightly beta: the accepted copy of the marks stays in the checkpoint worker until the page needs it (App speed thread 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('lazy-accepted-shadow', 'off', 'Open: keep the second copy of the marks only in the background worker until something needs it here')
on conflict (key) do nothing;
