-- Nightly beta: snap to the PDF's own drawing (line ends, midpoints, along straight lines), Snapping menu with Marks / Drawing switches (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('snap-content', 'off', 'Snap to the PDF''s own drawing: line ends, midpoints and along straight lines')
on conflict (key) do nothing;
