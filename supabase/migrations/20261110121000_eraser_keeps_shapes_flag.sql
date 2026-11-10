-- Nightly beta: the Partial eraser leaves non-ink marks alone (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('eraser-keeps-shapes', 'off', 'Partial eraser only cuts ink and leaves shapes, text and callouts alone')
on conflict (key) do nothing;
