-- Fix the projects self-query RLS recursion without changing sharing policies.
-- The helper is a read-only RLS check; the trigger is the concurrent quota guard.
-- Plan changes/downgrade archiving are still separate transactions and must be
-- brought into this protocol before claiming atomic entitlement transitions.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS survey_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA survey_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS survey_private.project_quota_guards (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE survey_private.project_quota_guards OWNER TO postgres;
ALTER TABLE survey_private.project_quota_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.project_quota_guards FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_create_own_project()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN
    RETURN false;
  END IF;
  RETURN (SELECT count(*) FROM public.projects p
          WHERE p.user_id = actor AND p.archived = false)
         < public.get_project_limit(actor);
END;
$$;
ALTER FUNCTION public.can_create_own_project() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_create_own_project() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_create_own_project() TO authenticated;

CREATE OR REPLACE FUNCTION survey_private.enforce_project_quota()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous_id uuid;
  caller_name text;
  caller_bypasses_rls boolean;
  active_count bigint;
BEGIN
  -- SECURITY DEFINER changes current_user, so recover the SQL caller from the
  -- server's SET ROLE state (or its login), never from user-controlled JWT JSON.
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role', true), 'none'), ''), session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO caller_bypasses_rls
    FROM pg_catalog.pg_roles r WHERE r.rolname = caller_name;
  -- RLS still owns authorization. Reject impossible INSERT owners before any
  -- target-account lock/count so a forged owner cannot probe their capacity.
  IF TG_OP = 'INSERT' AND NOT COALESCE(caller_bypasses_rls, false)
     AND (auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Project owner does not match signed-in user' USING ERRCODE = '42501';
  END IF;

  -- Archives, deletes, and metadata edits do not allocate capacity. Keeping
  -- deletion out of this protocol also permits auth.users cascades safely.
  IF NEW.archived IS DISTINCT FROM false THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.archived = false AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
      RETURN NEW;
    END IF;
    previous_id := OLD.id;
  END IF;

  -- A real row update both serializes READ COMMITTED callers and rejects stale
  -- REPEATABLE READ/SERIALIZABLE writers. An advisory lock alone cannot do both.
  INSERT INTO survey_private.project_quota_guards AS guards (user_id, revision)
    VALUES (NEW.user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET revision = guards.revision + 1;

  IF COALESCE(caller_bypasses_rls, false) THEN
    RETURN NEW;
  END IF;

  -- Separate statement after the lock: VOLATILE SPI reads get a fresh committed
  -- snapshot and see earlier rows in this statement. Exclude the replaced row.
  SELECT count(*) INTO active_count FROM public.projects p
    WHERE p.user_id = NEW.user_id AND p.archived = false
      AND (previous_id IS NULL OR p.id <> previous_id);
  IF active_count >= public.get_project_limit(NEW.user_id) THEN
    RAISE EXCEPTION 'Project limit reached' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION survey_private.enforce_project_quota() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.enforce_project_quota() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_project_quota ON public.projects;
CREATE TRIGGER enforce_project_quota
  BEFORE INSERT OR UPDATE OF user_id, archived ON public.projects
  FOR EACH ROW EXECUTE FUNCTION survey_private.enforce_project_quota();

-- ALTER fails closed if the expected policy is absent. Preserve its command,
-- roles and permissiveness, and leave all SELECT/UPDATE/DELETE policies intact.
ALTER POLICY "Users can create projects within limit" ON public.projects
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.can_create_own_project()));

COMMIT;
