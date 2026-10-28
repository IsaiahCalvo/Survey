-- Conditional checklist lines (Nightly beta, kept hidden: Survey Nightly does
-- not turn it on by itself; owner 2026-10-27 "wire it in, hide it").
insert into public.feature_flags (key, mode, description) values
  ('conditional-lines', 'off', 'Conditional checklist lines: show a line only after a certain answer (e.g. Address only when Protocol is OSDP).')
on conflict (key) do nothing;
