-- Turn legacy-collab-retired and survey-marker-fields on for everyone.
-- Approved by the owner on 2026-10-22 after a clean day on nightly.
update public.feature_flags
   set mode = 'on'
 where key in ('legacy-collab-retired', 'survey-marker-fields');
