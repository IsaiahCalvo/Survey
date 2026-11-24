-- Survey agent memory: two more kinds (Nightly beta).
--
--   kind 'state'     "Done means commissioned": heard = 'done', means = an
--                    entity's exact name. Asked once per project, then used.
--   kind 'placement' Which sheet kinds get marks (heard 'sheets', means
--                    'floor plan, schedule'), from the sheet-kind work.
--
-- Only widens the allowed kinds; no row changes.
alter table public.survey_agent_memory drop constraint if exists survey_agent_memory_kind_check;
alter table public.survey_agent_memory
  add constraint survey_agent_memory_kind_check check (kind in ('name', 'wording', 'state', 'placement'));
