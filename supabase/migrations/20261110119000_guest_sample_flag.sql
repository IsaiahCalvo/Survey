-- Nightly beta: the sample drawing opens signed out as a try-out (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('guest-sample', 'off', 'Try the sample drawing signed out, as a try-out that is not saved')
on conflict (key) do nothing;
