-- Survey media bucket, policies and functions (versioned copy).
--
-- Production ALREADY HAS THIS: it was applied by hand on 2026-10-01 and
-- recorded in supabase_migrations as version 20261001131413, so
-- `supabase db push` (deploy-production.yml) never runs this file there.
--
-- Until 2026-10-13 this file was a no-op placeholder that only kept the local
-- migration list in line with the remote history. Codex review (release PR):
-- any database that REPLAYS the migrations (a fresh local stack, staging, a
-- preview branch, `supabase db reset`) then had no survey-media bucket, no
-- storage policies and the documents-only quota functions, so media uploads
-- failed there and storage usage was wrong. It now carries the real schema.
--
-- The SQL below is the statement body of
-- supabase/proposed/20261001_survey_media_bucket.sql (the reviewed proposal,
-- with the full rationale and the VERIFY queries); keep the two identical -
-- tests/surveyMediaStorageContract.test.mjs checks that. Rollback:
-- supabase/rollbacks/20261001_survey_media_bucket.down.sql.
--
-- Idempotent, safe to run again on a database that already has it:
--   * bucket: INSERT ... ON CONFLICT (id) DO UPDATE;
--   * functions: CREATE OR REPLACE (same signatures and return types), with
--     REVOKE / GRANT restated;
--   * policies: DROP POLICY IF EXISTS before each CREATE POLICY;
--   * COMMENT ON: replaces;
--   * the pre-flight DO block only reads information_schema.
-- No table, column, index or trigger is created (the quota trigger itself is
-- from 20260818010000 and is untouched).

BEGIN;

-- 0. Pre-flight: the quota code keys survey media on storage.objects.owner_id
--    (the uploader, set by the Storage API from the JWT). Abort cleanly if this
--    storage schema predates that column.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'owner_id'
  ) THEN
    RAISE EXCEPTION 'storage.objects.owner_id is missing - survey media quota cannot be attributed; not applying';
  END IF;
END
$$;

-- 1. Bucket -------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'survey-media',
  'survey-media',
  false,
  52428800,
  ARRAY[
    'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm',
    'audio/ogg', 'audio/wav', 'audio/x-wav'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Object name -> document id; NULL for anything that is not exactly
-- "<document uuid>/<marker id>/<media uuid>.<ext>". A plain function (no table
-- access) so the policies never subquery storage.objects from a policy on
-- storage.objects. Marker ids are sanitized client-side to [A-Za-z0-9_-].
CREATE OR REPLACE FUNCTION public.survey_media_object_document_id(object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9_-]{1,128}/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-z0-9]{2,5}$'
    THEN substring(object_name from 1 for 36)::uuid
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public.survey_media_object_document_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.survey_media_object_document_id(text) TO authenticated, service_role;

-- 2. Policies -------------------------------------------------------------------
-- user_can_access_document (20260802000000) ladder: 'viewer' < 'editor' < 'owner';
-- an archived document resolves only for its owner.
DROP POLICY IF EXISTS survey_media_read ON storage.objects;
CREATE POLICY survey_media_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'survey-media'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR public.user_can_access_document(public.survey_media_object_document_id(name), 'viewer')
    )
  );

DROP POLICY IF EXISTS survey_media_insert ON storage.objects;
CREATE POLICY survey_media_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'survey-media'
    AND public.survey_media_object_document_id(name) IS NOT NULL
    AND public.user_can_access_document(public.survey_media_object_document_id(name), 'editor')
    -- Early, ADVISORY quota check (same shape as documents_owner_insert in
    -- 20260818010000): contentLength is the only size RLS can see. The
    -- enforce_documents_storage_quota trigger below is the real gate.
    AND (
      public.get_actual_storage_usage((SELECT auth.uid()))
      + COALESCE((metadata->>'contentLength')::bigint, 1)
    ) <= public.get_storage_limit((SELECT auth.uid()))
  );

DROP POLICY IF EXISTS survey_media_delete ON storage.objects;
CREATE POLICY survey_media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'survey-media'
    AND (
      owner_id = (SELECT auth.uid())::text
      OR public.user_can_access_document(public.survey_media_object_document_id(name), 'owner')
    )
  );
-- No UPDATE policy on purpose: a media object is written once under a fresh
-- id, so upsert / overwrite / move are refused.

-- 3. Usage now includes the media a user uploaded -----------------------------
-- Same self-scoping as 20260817010000: authenticated callers always get
-- auth.uid()'s own total; only JWT-less service callers can target p_user_id.
CREATE OR REPLACE FUNCTION public.get_actual_storage_usage(p_user_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
           SELECT SUM((o.metadata->>'size')::bigint)
             FROM storage.objects o
            WHERE o.bucket_id = 'documents'
              AND o.name LIKE COALESCE(auth.uid(), p_user_id)::text || '/%'
         ), 0)
       + COALESCE((
           SELECT SUM((o.metadata->>'size')::bigint)
             FROM storage.objects o
            WHERE o.bucket_id = 'survey-media'
              AND o.owner_id = COALESCE(auth.uid(), p_user_id)::text
         ), 0);
$$;

COMMENT ON FUNCTION public.get_actual_storage_usage(UUID) IS
  'KAL-390 + survey media (20261001): live storage usage for quota enforcement - storage.objects sizes under the user''s folder in the documents bucket plus the survey-media objects the user uploaded (owner_id). Spoof-proof. Self-scoping: authenticated callers always get auth.uid()''s own total regardless of p_user_id; only JWT-less service callers can target another user.';

-- (Grants are unchanged by CREATE OR REPLACE; restated for a fresh database.)
REVOKE ALL ON FUNCTION public.get_actual_storage_usage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_actual_storage_usage(UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_actual_storage_usage(UUID) FROM anon;

-- 4. Authoritative byte gate covers survey media -------------------------------
-- Replaces the 20260818010000 body. The trigger itself
-- (enforce_documents_storage_quota BEFORE INSERT OR UPDATE ON storage.objects)
-- already exists and is not touched.
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
  -- Who pays. documents: the first folder of the path (unchanged). survey-media:
  -- the uploader (owner_id, set by the Storage API from the uploader's JWT and
  -- present on the superuser write that carries the real size); the path names
  -- the document, which may belong to someone else.
  IF NEW.bucket_id = 'documents' THEN
    BEGIN
      v_owner := (storage.foldername(NEW.name))[1]::uuid;
    EXCEPTION WHEN others THEN
      RETURN NEW;  -- not a per-user object path; nothing to meter
    END;
  ELSIF NEW.bucket_id = 'survey-media' THEN
    BEGIN
      v_owner := NULLIF(NEW.owner_id, '')::uuid;
    EXCEPTION WHEN others THEN
      RETURN NEW;
    END;
  ELSE
    RETURN NEW;
  END IF;

  IF v_owner IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_size := (NEW.metadata->>'size')::bigint;

  -- Unknown incoming size => size-neutral write (RLS permission probe,
  -- internal bookkeeping). Blocking those would break uploads.
  IF v_new_size IS NULL THEN
    RETURN NEW;
  END IF;

  -- Current stored size of the object being written (by name, so both passes
  -- of an upsert see the row being replaced).
  SELECT COALESCE(MAX((o.metadata->>'size')::bigint), 0)
    INTO v_old_size
    FROM storage.objects o
   WHERE o.bucket_id = NEW.bucket_id
     AND o.name = NEW.name;

  -- Never block a write that does not grow the object (same-size and shrinking
  -- saves must always succeed, even over the allowance). Lock-free hot path.
  IF v_new_size <= v_old_size THEN
    RETURN NEW;
  END IF;

  -- Growing write: serialize per owner (same key as 20260818010000, shared by
  -- both buckets so a PDF save and a media upload cannot race each other).
  PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('kal390:' || v_owner::text, 0));

  SELECT COALESCE((
           SELECT SUM((o.metadata->>'size')::bigint)
             FROM storage.objects o
            WHERE o.bucket_id = 'documents'
              AND o.name LIKE v_owner::text || '/%'
              AND NOT (NEW.bucket_id = 'documents' AND o.name = NEW.name)
         ), 0)
       + COALESCE((
           SELECT SUM((o.metadata->>'size')::bigint)
             FROM storage.objects o
            WHERE o.bucket_id = 'survey-media'
              AND o.owner_id = v_owner::text
              AND NOT (NEW.bucket_id = 'survey-media' AND o.name = NEW.name)
         ), 0)
    INTO v_other_total;

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
  'KAL-390 + survey media (20261001): authoritative storage byte gate for the documents bucket (owner = first path folder) and the survey-media bucket (owner = uploader, owner_id). Totals include both buckets. RLS cannot do this job - the storage service checks policies in a probe transaction whose metadata has no "size" key, then writes the real size as superuser. Never blocks a non-growing write.';

-- 5. Orphaned media finder (service role only) ---------------------------------
-- Media whose document row is gone (purged, swept, account deleted). The caller
-- removes them through the Storage API (see the header).
CREATE OR REPLACE FUNCTION public.list_orphaned_survey_media(p_limit integer DEFAULT 500)
RETURNS TABLE(name text, owner_id text, size bigint, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.name, o.owner_id, (o.metadata->>'size')::bigint, o.created_at
    FROM storage.objects o
   WHERE o.bucket_id = 'survey-media'
     AND public.survey_media_object_document_id(o.name) IS NOT NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.documents d
            WHERE d.id = public.survey_media_object_document_id(o.name))
   ORDER BY o.created_at
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

COMMENT ON FUNCTION public.list_orphaned_survey_media(integer) IS
  'Survey media (20261001): survey-media objects whose document row no longer exists. service_role only; the archive-purge-sweep Edge Function (follow-up) removes them through the Storage API.';

REVOKE ALL ON FUNCTION public.list_orphaned_survey_media(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphaned_survey_media(integer) TO service_role;

COMMIT;
