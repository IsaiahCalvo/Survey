-- Nightly beta: a page change (rotate, delete, insert, move, duplicate, paste) in one window makes the other windows with the document open reload its PDF, and blocks their page changes while it saves.
insert into public.feature_flags (key, mode, description)
values ('page-op-sync', 'off', 'Page changes in one window reload the PDF in the other windows that have it open')
on conflict (key) do nothing;
