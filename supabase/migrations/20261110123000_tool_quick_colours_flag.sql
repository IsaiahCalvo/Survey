-- Nightly beta: per-tool quick colours, highlighter gets yellow/green/pink (Drawboard PDF Pro trial audit 2026-11-10).
insert into public.feature_flags (key, mode, description)
values ('tool-quick-colours', 'off', 'Highlighter quick colours are highlighter colours (yellow, green, pink)')
on conflict (key) do nothing;
