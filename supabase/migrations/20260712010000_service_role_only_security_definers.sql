-- Restore least privilege for maintenance RPCs that run as SECURITY DEFINER.
--
-- The 20260702010000 advisor migration correctly removed the default PUBLIC
-- grants, but then granted these cross-user/destructive functions to every
-- authenticated account. They are invoked only by service-role Edge Functions,
-- database triggers, or scheduled maintenance. Client roles must never be able
-- to call them directly.

BEGIN;

REVOKE ALL ON FUNCTION public.archive_excess_documents(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_excess_documents(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.archive_excess_projects(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_excess_projects(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.archive_excess_projects(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_excess_projects(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.check_collaborator_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_collaborator_by_email(text) TO service_role;

REVOKE ALL ON FUNCTION public.check_user_collaborator_eligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_collaborator_eligibility(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;

REVOKE ALL ON FUNCTION public.handle_downgrade_to_free(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_downgrade_to_free(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.kal309_persist_created_token(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kal309_persist_created_token(uuid, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.recalculate_all_user_storage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_all_user_storage() TO service_role;

REVOKE ALL ON FUNCTION public.recalculate_user_storage(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_user_storage(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_usage_metric(uuid, character varying, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_usage_metric(uuid, character varying, bigint, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.sweep_annotation_trash_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_annotation_trash_events(integer) TO service_role;

-- Fail the migration if a later edit accidentally leaves either client role
-- with EXECUTE or removes the service-role grant.
DO $$
DECLARE
  function_signature text;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.archive_excess_documents(uuid, integer)',
    'public.archive_excess_projects(uuid, integer)',
    'public.archive_excess_projects(uuid, uuid)',
    'public.check_collaborator_by_email(text)',
    'public.check_user_collaborator_eligibility(uuid)',
    'public.get_user_id_by_email(text)',
    'public.handle_downgrade_to_free(uuid)',
    'public.kal309_persist_created_token(uuid, text, text, text, text, text)',
    'public.recalculate_all_user_storage()',
    'public.recalculate_user_storage(uuid)',
    'public.record_usage_metric(uuid, character varying, bigint, jsonb)',
    'public.sweep_annotation_trash_events(integer)'
  ]
  LOOP
    IF has_function_privilege('anon', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon still has EXECUTE on %', function_signature;
    END IF;

    IF has_function_privilege('authenticated', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated still has EXECUTE on %', function_signature;
    END IF;

    IF NOT has_function_privilege('service_role', function_signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lacks EXECUTE on %', function_signature;
    END IF;
  END LOOP;
END
$$;

COMMIT;
