-- "Report" on a Survey agent answer (privacy policy and Google Play's AI
-- content rule: people can flag a harmful or wrong AI answer from inside the
-- app). A report is one more row in survey_agent_voice_logs, read by the team
-- with the service role like the voice logs, kept 30 days by the same prune.
alter table public.survey_agent_voice_logs
  drop constraint if exists survey_agent_voice_logs_reason_check;
alter table public.survey_agent_voice_logs
  add constraint survey_agent_voice_logs_reason_check
  check (reason in ('manual', 'error', 'report'));
