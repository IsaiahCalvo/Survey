-- These system-quota archive helpers accept an arbitrary account ID and run
-- as their definer. Known callers are the service-role billing webhook and
-- the postgres-owned downgrade wrapper, not authenticated app requests.
-- Keep their behavior unchanged while removing direct client execution.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  target regprocedure;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.handle_downgrade_to_free(uuid)'::regprocedure,
    'public.archive_excess_projects(uuid,integer)'::regprocedure,
    'public.archive_excess_projects(uuid,uuid)'::regprocedure,
    'public.archive_excess_documents(uuid,integer)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
      WHERE p.oid = target AND p.prosecdef AND r.rolname = 'postgres'
    ) THEN
      RAISE EXCEPTION 'Unexpected archive helper owner or execution mode: %', target;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_downgrade_to_free(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_excess_projects(uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_excess_projects(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_excess_documents(uuid,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.handle_downgrade_to_free(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_excess_projects(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_excess_projects(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_excess_documents(uuid,integer) TO service_role;

COMMIT;
