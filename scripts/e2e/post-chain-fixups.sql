-- scripts/e2e/post-chain-fixups.sql — runs LAST in the local E2E stack, after
-- every real migration (scripts/e2e-local-supabase.mjs copies it in as the
-- final migration of the throwaway workdir). Never part of supabase/migrations/.
--
-- Why: 20260211224035_fix_function_search_path.sql pins `search_path = ''` on
-- ~40 functions whose bodies, as the repo's migrations define them, use
-- UNQUALIFIED names (e.g. handle_new_user_subscription inserts into
-- `user_subscriptions`, add_document_owner_collaborator into
-- `document_collaborators`). Production evidently has schema-qualified bodies
-- that were edited outside the migration chain; on a fresh database replayed
-- from the repo those functions fail with `relation "..." does not exist`,
-- which breaks every sign-up (auth.users trigger) and every project/document
-- insert (owner-collaborator, project-status and storage triggers).
--
-- Locally we give those functions a search_path that resolves public objects.
-- This only affects functions that still carry the empty search_path.

DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proconfig IS NOT NULL
      AND 'search_path=""' = ANY (p.proconfig)
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', fn.signature);
  END LOOP;
END;
$$;
