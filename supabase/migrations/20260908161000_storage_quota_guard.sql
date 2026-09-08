-- Meter actual stored bytes after the final row operation, including writes
-- made by the storage service with no user JWT. The former BEFORE trigger
-- could mistake a concurrent delete/recreate for a shrinking overwrite, and
-- its advisory lock did not refresh a REPEATABLE READ transaction's snapshot.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- Fail closed on an unexpected trigger target or event set. Both the deployed
-- BEFORE form and this migration's AFTER form are allowed for repeat runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'storage.objects'::regclass
      AND t.tgname = 'enforce_documents_storage_quota'
      AND t.tgfoid = 'public.enforce_documents_storage_quota()'::regprocedure
      AND t.tgtype IN (21, 23) AND t.tgnargs = 0
      AND t.tgqual IS NULL AND t.tgenabled = 'O' AND NOT t.tgisinternal
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
        WHERE p.oid = t.tgfoid AND r.rolname = 'postgres' AND (r.rolsuper OR r.rolbypassrls)
      )
  ) THEN
    RAISE EXCEPTION 'Unexpected storage quota trigger; inspect its definition before applying this migration';
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS survey_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA survey_private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS survey_private.storage_quota_guards (
  owner_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0
);
-- No auth.users FK: existing storage metering accepts any UUID owner prefix,
-- including retained service/legacy objects without a current auth user.
ALTER TABLE survey_private.storage_quota_guards OWNER TO postgres;
ALTER TABLE survey_private.storage_quota_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON survey_private.storage_quota_guards FROM PUBLIC, anon, authenticated, service_role;

-- CREATE OR REPLACE preserves this existing function's owner and grants.
CREATE OR REPLACE FUNCTION public.enforce_documents_storage_quota()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
  v_prefix text;
  v_new_size bigint;
  v_old_size bigint;
  v_total bigint;
  v_limit bigint;
BEGIN
  IF NEW.bucket_id IS DISTINCT FROM 'documents' THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_prefix := (storage.foldername(NEW.name))[1];
    v_owner := v_prefix::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NEW;
  END;
  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_size := (NEW.metadata->>'size')::bigint;
  -- The storage API's permission probe supplies contentLength, not actual size.
  IF v_new_size IS NULL THEN
    RETURN NEW;
  END IF;
  IF v_new_size < 0 THEN
    RAISE EXCEPTION 'Stored object size cannot be negative' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.bucket_id = 'documents' THEN
    v_old_size := (OLD.metadata->>'size')::bigint;
    IF v_old_size < 0 THEN
      RAISE EXCEPTION 'Existing stored object size is invalid; repair its metadata first' USING ERRCODE = '42501';
    END IF;
    IF (storage.foldername(OLD.name))[1] = v_prefix THEN
      -- OLD is the actual replaced row, not a snapshot lookup of a name that
      -- another transaction could delete. Same-size/shrinking saves (including
      -- ON CONFLICT UPDATE and same-owner renames) stay allowed over quota.
      IF v_new_size <= v_old_size THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  IF v_new_size = 0 THEN
    RETURN NEW;
  END IF;

  -- The usage SUM and early storage policies use canonical UUID prefixes.
  -- Reject new/growing aliases (uppercase, braces, omitted hyphens) rather
  -- than normalize the owner but silently omit NEW from the byte sum. Existing
  -- same-prefix non-growing legacy saves above remain valid; renames between
  -- differently spelled prefixes must pass this allocation check.
  IF v_prefix IS DISTINCT FROM v_owner::text THEN
    RAISE EXCEPTION 'New or growing document objects require a canonical lowercase UUID owner path'
      USING ERRCODE = '42501';
  END IF;

  -- A real row write serializes each owner's allocations at READ COMMITTED
  -- and forces stale REPEATABLE READ/SERIALIZABLE writers to abort (40001).
  -- Never exempt service roles: they perform the actual-byte storage write.
  INSERT INTO survey_private.storage_quota_guards AS guards (owner_id, revision)
    VALUES (v_owner, 1)
    ON CONFLICT (owner_id) DO UPDATE SET revision = guards.revision + 1;

  -- Separate VOLATILE query after the guard. AFTER visibility includes the
  -- actual inserted/updated row and all rows of a multi-row statement.
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
    INTO v_total FROM storage.objects o
    WHERE o.bucket_id = 'documents' AND o.name LIKE v_owner::text || '/%';
  v_limit := public.get_storage_limit(v_owner);
  IF v_total > v_limit THEN
    RAISE EXCEPTION
      'Storage quota exceeded: this save needs % bytes of the % bytes allowed on your plan.',
      v_total, v_limit
      USING ERRCODE = '42501',
            HINT = 'Free space by deleting documents, or upgrade your plan.';
  END IF;
  RETURN NEW;
END;
$$;

-- Hosted postgres has TRIGGER permission, but need not own storage.objects.
-- Replacing this exact trigger avoids DROP's stronger ownership requirement.
CREATE OR REPLACE TRIGGER enforce_documents_storage_quota
  AFTER INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_documents_storage_quota();

COMMENT ON FUNCTION public.enforce_documents_storage_quota() IS
  'Meters actual positive storage allocations after the final INSERT/UPDATE, including storage-service writes. Same-owner non-growing updates remain lock-free; a private owner guard serializes growth and rejects stale snapshots. Entitlement changes remain a separate protocol.';
COMMIT;
