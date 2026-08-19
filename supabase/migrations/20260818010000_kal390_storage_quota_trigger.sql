-- KAL-390 (follow-up) — the storage byte gate cannot live in an RLS policy.
-- Move it to a trigger on storage.objects, and stop the RLS policies from
-- locking an over-quota account out of saving.
--
-- WHY 20260817010000 DID NOT HOLD
-- --------------------------------
-- That migration gated bytes with `metadata->>'size'` inside the
-- storage.objects INSERT/UPDATE policies. Verified against a local stack
-- running the SAME storage-api build as production (v1.69.0, tenant migration
-- head `0061-mark-filename-immutable`), two facts make that impossible:
--
--   1. `metadata->>'size'` is ALWAYS NULL inside an RLS policy. The storage
--      service checks RLS in a throwaway "permission probe" transaction
--      (Uploader.canUpload -> db.testPermission) whose synthetic row carries
--      only `{"mimetype": ..., "contentLength": ...}`. Probed directly by
--      raising the value out of a policy:
--        INSERT  -> metadata={"mimetype": "application/pdf", "contentLength": 3145728}
--        UPSERT  -> metadata={"mimetype": "application/pdf", "contentLength": 7340032}
--      There is no `size` key at check time, so every `metadata->>'size'`
--      clause silently degraded to its COALESCE fallback.
--
--   2. The write that DOES carry the true size never passes through RLS.
--      Uploader.completeUpload runs `this.db.asSuperUser()` and upserts the
--      backend-reported metadata. Proved by installing policies demanding
--      `(metadata->>'size') IS NULL` and uploading anyway: both the insert and
--      the upsert returned HTTP 200 and the stored rows ended up with real
--      sizes (2,097,152 and 4,194,304) that those policies forbid.
--
-- Consequences of (1) + (2) in the deployed policies:
--   * UPDATE  `usage - old + COALESCE(NULL, old)` == `usage`. The overwrite
--     delta cancelled out, so ANY growth passed -> the reported bypass
--     (1 KiB object re-saved as 5 MiB, usage 102,761,472 -> 108,003,328).
--   * UPDATE also blocked EVERY overwrite once `usage > limit`, including
--     same-size and shrinking saves. An account that is over its allowance
--     (legacy overage, tier downgrade) could not save at all. Reproduced
--     locally: overwrite at 108,004,352 used -> HTTP 400, row unchanged.
--   * INSERT  `usage + COALESCE(NULL, 1)` == `usage + 1`. Not a byte gate at
--     all — only a "must currently be under the limit" gate, so a new object
--     of any size up to the 50 MiB per-file cap landed while under the limit.
--
-- THE FIX
-- -------
--   * A BEFORE INSERT OR UPDATE trigger on storage.objects is the authoritative
--     byte gate. Triggers fire for the storage service's superuser write too
--     (RLS is bypassed there; triggers are not), so the trigger is the only
--     place in the database that ever sees the real object size. This is the
--     same mechanism — and the same `ERRCODE = '42501'` idiom — Supabase's own
--     `storage.protect_delete()` trigger uses on this table. `postgres` holds
--     TRIGGER privilege on storage.objects on hosted Supabase (verified on the
--     production project) and has rolbypassrls, so a SECURITY DEFINER function
--     owned by postgres sums usage unfiltered.
--   * The RLS policies keep a cheap EARLY gate on `contentLength` (the key that
--     genuinely is present at probe time) so an over-quota upload is refused
--     before 50 MiB is streamed. It is advisory only — `contentLength` is
--     client-declared — and the trigger remains the real gate.
--   * Both the trigger and the policies never block a write that does not grow
--     the object. Same-size saves and shrinking saves always pass, at, below,
--     or above the limit, so the app's save path (replaceDocument /
--     uploadDataFile upsert onto the SAME object path) cannot be broken by
--     this gate. Only growth past the tier limit is refused.
--
-- STILL ADVISORY (documented, not a hole): the public.documents INSERT policy's
-- `file_size` clause. The app inserts the documents row BEFORE uploading bytes,
-- so file_size is client-supplied and the real bytes are not in storage yet.
-- It cannot be made authoritative without reordering the app's write sequence.
-- It does not need to be: storage.objects is where bytes actually land, and the
-- trigger below meters them from ground truth regardless of what the documents
-- row claimed.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Authoritative byte gate: trigger on storage.objects.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_documents_storage_quota()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner       UUID;
  v_new_size    BIGINT;
  v_old_size    BIGINT := 0;
  v_other_total BIGINT := 0;
  v_limit       BIGINT;
BEGIN
  IF NEW.bucket_id IS DISTINCT FROM 'documents' THEN
    RETURN NEW;
  END IF;

  -- Ownership comes from the object path, NOT auth.uid(). The write that
  -- carries the real size is made by the storage service's own role with no
  -- end-user JWT attached, so auth.uid() is NULL there.
  BEGIN
    v_owner := (storage.foldername(NEW.name))[1]::uuid;
  EXCEPTION WHEN others THEN
    RETURN NEW;  -- not a per-user object path; nothing to meter
  END;

  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_size := (NEW.metadata->>'size')::bigint;

  -- Unknown incoming size => size-neutral write. This is what the storage
  -- service's RLS permission probe and internal bookkeeping updates look like.
  -- Blocking those would break uploads without metering anything.
  IF v_new_size IS NULL THEN
    RETURN NEW;
  END IF;

  -- Current stored size of the object being written, and the total of all the
  -- owner's OTHER objects. Keyed on name rather than id so this is correct for
  -- both passes of an upsert: `INSERT ... ON CONFLICT DO UPDATE` fires the
  -- BEFORE INSERT trigger with a fresh NEW.id before firing BEFORE UPDATE, and
  -- the row being replaced must be excluded from the total in both passes.
  SELECT
    COALESCE(SUM((o.metadata->>'size')::bigint) FILTER (WHERE o.name <> NEW.name), 0),
    COALESCE(MAX((o.metadata->>'size')::bigint) FILTER (WHERE o.name  = NEW.name), 0)
  INTO v_other_total, v_old_size
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.name LIKE v_owner::text || '/%';

  -- Never block a write that does not grow the object. Same-size saves and
  -- shrinking saves must always succeed — including for an account that is
  -- already over its allowance — or the app's normal save path breaks.
  -- This is also the hot path for ordinary saves, and it stays lock-free.
  IF v_new_size <= v_old_size THEN
    RETURN NEW;
  END IF;

  -- This write grows the object, so it has to be metered against the limit.
  -- Serialize per owner first: without this, two concurrent growing writes
  -- would each read a pre-write snapshot, each conclude it fits, and together
  -- overshoot the limit. The lock is per user and released at commit, and the
  -- non-growing path above never reaches it.
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('kal390:' || v_owner::text, 0));

  SELECT COALESCE(SUM((o.metadata->>'size')::bigint) FILTER (WHERE o.name <> NEW.name), 0)
  INTO v_other_total
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.name LIKE v_owner::text || '/%';

  v_limit := public.get_storage_limit(v_owner);

  IF v_other_total + v_new_size > v_limit THEN
    RAISE EXCEPTION
      'Storage quota exceeded: this save needs % bytes of the % bytes allowed on your plan.',
      v_other_total + v_new_size, v_limit
      USING ERRCODE = '42501',
            HINT    = 'Free space by deleting documents, or upgrade your plan.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_documents_storage_quota() IS
  'KAL-390: authoritative storage byte gate. RLS cannot do this job — the storage service checks policies in a probe transaction whose metadata has no "size" key, and then writes the real size as superuser. A trigger sees the true size on every write. Never blocks a non-growing write, so same-size and shrinking saves always succeed.';

-- CREATE OR REPLACE (not DROP + CREATE): DROP TRIGGER requires ownership of
-- storage.objects, which belongs to supabase_storage_admin. CREATE OR REPLACE
-- needs only the TRIGGER privilege that postgres holds, and is idempotent.
CREATE OR REPLACE TRIGGER enforce_documents_storage_quota
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_documents_storage_quota();

-- ---------------------------------------------------------------------------
-- 2. RLS policies: early, advisory gate on the size the client DECLARES, and
--    — critically — no longer a lockout for accounts that are over quota.
-- ---------------------------------------------------------------------------
-- Shared shape for INSERT and UPDATE. `contentLength` is the only size the
-- policy can actually see (see the probe evidence in the header). It is
-- client-declared, so this is a fail-fast convenience, never the real gate:
--   * non-growing write (new <= currently stored) -> always allowed;
--   * otherwise the post-write total must fit the tier limit.
-- When contentLength is absent the first branch is trivially true and the
-- policy stands aside for the trigger.
DROP POLICY IF EXISTS documents_owner_insert ON storage.objects;
CREATE POLICY documents_owner_insert ON storage.objects
    FOR INSERT TO public
    WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND (
            COALESCE((metadata->>'contentLength')::bigint, 0)
              <= public.get_stored_object_size(bucket_id, name)
            OR (
                public.get_actual_storage_usage(auth.uid())
                - public.get_stored_object_size(bucket_id, name)
                + COALESCE((metadata->>'contentLength')::bigint, 1)
            ) <= public.get_storage_limit(auth.uid())
        )
    );

COMMENT ON POLICY documents_owner_insert ON storage.objects IS
  'KAL-390: owner-folder uploads only, plus an EARLY advisory size check on the client-declared contentLength (the only size an RLS policy can see). Non-growing writes always pass so upsert saves never break. The enforce_documents_storage_quota trigger is the authoritative byte gate.';

DROP POLICY IF EXISTS documents_owner_update ON storage.objects;
CREATE POLICY documents_owner_update ON storage.objects
    FOR UPDATE TO public
    USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text)
    WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
        AND (
            COALESCE((metadata->>'contentLength')::bigint, 0)
              <= public.get_stored_object_size(bucket_id, name)
            OR (
                public.get_actual_storage_usage(auth.uid())
                - public.get_stored_object_size(bucket_id, name)
                + COALESCE((metadata->>'contentLength')::bigint,
                           public.get_stored_object_size(bucket_id, name))
            ) <= public.get_storage_limit(auth.uid())
        )
    );

COMMENT ON POLICY documents_owner_update ON storage.objects IS
  'KAL-390: owner-folder overwrites only, with the same early advisory size check as the INSERT policy. Replaces a version that blocked EVERY overwrite (including shrinks) once usage exceeded the limit, which locked over-quota accounts out of saving. The enforce_documents_storage_quota trigger is the authoritative byte gate.';

COMMIT;
