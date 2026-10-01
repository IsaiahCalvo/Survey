-- Rollback for: supabase/proposed/20261001_survey_media_bucket.sql
-- Date: 2026-10-01
-- Restores get_actual_storage_usage (20260817010000) and
-- enforce_documents_storage_quota (20260818010000) to their documents-only
-- bodies, and drops the survey-media policies and helper functions.
-- Idempotent: IF EXISTS / CREATE OR REPLACE throughout.
--
-- The bucket itself is NOT dropped here. Its objects must be removed through
-- the Storage API first (Dashboard > Storage > survey-media > select all >
-- Delete, or storage.from('survey-media').remove(...) with the service role);
-- deleting storage.objects rows from SQL strands the bytes and is refused by
-- storage.protect_delete(). Then, once it is empty:
--   DELETE FROM storage.buckets WHERE id = 'survey-media';
-- While media objects still exist after this rollback, nobody can read, add or
-- delete them through the API (no policies), and they no longer count toward
-- anyone's quota.

BEGIN;

DROP POLICY IF EXISTS survey_media_read   ON storage.objects;
DROP POLICY IF EXISTS survey_media_insert ON storage.objects;
DROP POLICY IF EXISTS survey_media_delete ON storage.objects;

DROP FUNCTION IF EXISTS public.list_orphaned_survey_media(integer);

-- documents-only usage (as in 20260817010000)
CREATE OR REPLACE FUNCTION public.get_actual_storage_usage(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(SUM((o.metadata->>'size')::bigint), 0)
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.name LIKE COALESCE(auth.uid(), p_user_id)::text || '/%';
$$;

COMMENT ON FUNCTION public.get_actual_storage_usage(UUID) IS
  'KAL-390: live storage usage for quota enforcement, summed from storage.objects sizes under the user''s folder in the documents bucket. Spoof-proof — ignores client-reported documents.file_size and the display-only storage_used_bytes counter. Self-scoping: authenticated callers always get auth.uid()''s own total regardless of p_user_id; only JWT-less service callers can target another user.';

-- documents-only byte gate (as in 20260818010000; comments trimmed)
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

  BEGIN
    v_owner := (storage.foldername(NEW.name))[1]::uuid;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;

  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_size := (NEW.metadata->>'size')::bigint;

  IF v_new_size IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM((o.metadata->>'size')::bigint) FILTER (WHERE o.name <> NEW.name), 0),
    COALESCE(MAX((o.metadata->>'size')::bigint) FILTER (WHERE o.name  = NEW.name), 0)
  INTO v_other_total, v_old_size
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.name LIKE v_owner::text || '/%';

  IF v_new_size <= v_old_size THEN
    RETURN NEW;
  END IF;

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

-- Dropped last: the policies above referenced it.
DROP FUNCTION IF EXISTS public.survey_media_object_document_id(text);

COMMIT;
