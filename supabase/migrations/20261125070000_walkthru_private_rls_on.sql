-- Walkthru issue 343: the Supabase security advisor flags five walkthru_private
-- tables with Row Level Security off. Only postgres holds grants on them, and the
-- account-deletion cascade and audio rollout code reach them through security
-- definer functions owned by postgres (which bypasses RLS), so turning RLS on with
-- no policies changes no app path. It matches the other walkthru_private tables
-- and keeps the rows shut if a grant is ever added by mistake.
do $walkthruprivaterls$
declare
  t text;
begin
  foreach t in array array[
    'account_deletion_organization_candidates',
    'account_deletion_organization_transfers',
    'account_deletion_requests',
    'audio_upload_rollout_config',
    'audio_upload_rollout_metrics'
  ] loop
    if to_regclass('walkthru_private.' || t) is not null then
      execute format('alter table walkthru_private.%I enable row level security', t);
    end if;
  end loop;
end
$walkthruprivaterls$;
