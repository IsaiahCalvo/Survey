-- Repair document INSERT self-query recursion and serialize active allocations.
-- Object-byte metering is separate: preserve its storage-service enforcement.
-- Entitlement changes still need a shared transaction protocol with archiving.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS survey_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA survey_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS survey_private.document_quota_guards (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE survey_private.document_quota_guards OWNER TO postgres;
ALTER TABLE survey_private.document_quota_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.document_quota_guards FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_upload_own_document()
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
  RETURN (SELECT count(*) FROM public.documents d
          WHERE d.user_id = actor AND d.archived = false)
         < public.get_document_limit(actor);
END;
$$;
ALTER FUNCTION public.can_upload_own_document() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_upload_own_document() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_upload_own_document() TO authenticated;

CREATE OR REPLACE FUNCTION survey_private.enforce_document_quota()
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
  -- Read trusted SQL role state, not a JWT role claim. current_user is the
  -- definer inside this function; direct logins instead use session_user.
  caller_name := COALESCE(NULLIF(NULLIF(current_setting('role', true), 'none'), ''), session_user);
  SELECT r.rolsuper OR r.rolbypassrls INTO caller_bypasses_rls
    FROM pg_catalog.pg_roles r WHERE r.rolname = caller_name;
  IF TG_OP = 'INSERT' AND NOT COALESCE(caller_bypasses_rls, false)
     AND (auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'Document owner does not match signed-in user' USING ERRCODE = '42501';
  END IF;

  -- Metadata saves, deletes, and releases of capacity stay out of this guard.
  -- user_archived_at is not the system archive flag and does not release quota.
  IF NEW.archived IS DISTINCT FROM false THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.archived = false AND OLD.user_id IS NOT DISTINCT FROM NEW.user_id THEN
      RETURN NEW;
    END IF;
    previous_id := OLD.id;
  END IF;

  -- Serialize active-slot additions, including exempt service/admin writes.
  -- A real row change also forces stale RR/SERIALIZABLE writers to retry;
  -- advisory locks alone retain their old transaction snapshot.
  INSERT INTO survey_private.document_quota_guards AS guards (user_id, revision)
    VALUES (NEW.user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET revision = guards.revision + 1;
  IF COALESCE(caller_bypasses_rls, false) THEN
    RETURN NEW;
  END IF;

  -- A fresh VOLATILE query after the lock sees committed competitors at READ
  -- COMMITTED and earlier rows of this statement. Exclude the replaced row.
  SELECT count(*) INTO active_count FROM public.documents d
    WHERE d.user_id = NEW.user_id AND d.archived = false
      AND (previous_id IS NULL OR d.id <> previous_id);
  IF active_count >= public.get_document_limit(NEW.user_id) THEN
    RAISE EXCEPTION 'Document limit reached' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION survey_private.enforce_document_quota() OWNER TO postgres;
REVOKE ALL ON FUNCTION survey_private.enforce_document_quota() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_document_quota ON public.documents;
CREATE TRIGGER enforce_document_quota
  BEFORE INSERT OR UPDATE OF user_id, archived ON public.documents
  FOR EACH ROW EXECUTE FUNCTION survey_private.enforce_document_quota();

-- Preserve the current owner and inclusive storage checks, policy roles and
-- all sharing/update/delete rules. The existing object trigger meters bytes.
ALTER POLICY "Users can upload documents within limits" ON public.documents
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (SELECT public.can_upload_own_document())
    AND public.get_actual_storage_usage((SELECT auth.uid())) <= public.get_storage_limit((SELECT auth.uid()))
  );

COMMIT;
