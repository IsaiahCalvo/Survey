-- PROPOSED - NOT APPLIED. Needs the owner's go-ahead; prod "Survey" is
-- hand-managed (apply in the SQL editor / Management API, then record the
-- version). Kept out of supabase/migrations/ because deploy-production runs
-- `supabase db push`. Rollback: supabase/rollbacks/20261001_survey_media_bucket.down.sql
--
-- Survey media (photos, videos, audio) as real files - owner approval
-- 2026-10-01, see the media contract and src/services/surveyMediaService.js.
-- Until this is applied the app's uploads fail with "Media storage isn't set
-- up yet" and existing inline (base64) note media keeps working.
--
-- What it does:
--   1. private bucket "survey-media", 100 MiB per file, photo/video/audio types
--      only. Object name: <document_id>/<marker_id>/<media_id>.<ext>;
--   2. storage.objects policies (no UPDATE policy: media objects are immutable,
--      so upsert/overwrite/move are refused):
--        survey_media_read   - viewer access to the document (or the uploader);
--        survey_media_insert - editor access to the document, plus the same
--                              early advisory quota check as documents_owner_insert
--                              (client-declared contentLength), charged to the
--                              uploader;
--        survey_media_delete - the uploader, or the document owner;
--   3. public.get_actual_storage_usage(uid) also counts the survey-media
--      objects that uid uploaded (storage.objects.owner_id), so the usage
--      meter and the documents INSERT policy see media too;
--   4. public.enforce_documents_storage_quota() - the authoritative KAL-390
--      byte gate trigger (RLS cannot see real sizes, see 20260818010000) -
--      now meters survey-media writes against the UPLOADER's limit and counts
--      the uploader's media when metering their PDF uploads. Behaviour for the
--      documents bucket is otherwise unchanged (same owner-from-path rule,
--      same never-block-a-non-growing-write rule, same advisory lock key);
--   5. public.list_orphaned_survey_media(limit) - service_role only - names
--      the media objects whose document row no longer exists.
--
-- Deleting / purging a document and its media (why part of this is not SQL):
--   * SQL cannot remove the bytes: deleting storage.objects rows strands the S3
--     objects (and Supabase's storage.protect_delete() trigger refuses direct
--     deletes anyway). Every existing purge path therefore reports paths and
--     lets a Storage-API caller unlink them - same rule here.
--   * Archive (archive_document / archive_project) keeps the document row, so
--     its media stays readable to the owner and comes back on restore. Nothing
--     to do.
--   * "Delete forever" in the app (deleteDocumentForever /
--     deleteProjectForever) now removes the purged documents' media right after
--     the purge RPC succeeds (best-effort, like the PDF unlink). Once the row is
--     gone the "document owner" half of survey_media_delete no longer matches,
--     so that client pass removes the media the purging user uploaded
--     (survey_media_read/delete let an uploader see and remove their own
--     objects); a collaborator's media in that document is left for the sweep.
--   * The nightly sweep (sweep_expired_archives via the archive-purge-sweep
--     Edge Function), account deletion (delete-account cascades documents) and
--     any other row delete leave media behind as orphans. list_orphaned_survey_media()
--     finds them for every path at once. The Edge Function is NOT changed in this
--     branch (brief: no edge-function changes); the follow-up is ~15 lines in
--     supabase/functions/archive-purge-sweep/index.ts after the PDF unlink:
--       const { data: media } = await supabase.rpc('list_orphaned_survey_media', { p_limit: 1000 });
--       const names = (media ?? []).map((r) => r.name);
--       for (let i = 0; i < names.length; i += UNLINK_CHUNK)
--         await supabase.storage.from('survey-media').remove(names.slice(i, i + UNLINK_CHUNK));
--     (service role bypasses RLS; best-effort like the PDF unlink.) Until then
--     orphans only cost storage: no policy lets anyone but their uploader read
--     them (the document check fails once the row is gone), and they keep
--     counting toward the uploader's quota until removed.
--   * Media a user uploaded to SOMEONE ELSE's document survives that user's
--     account deletion (it belongs to the live document). It then counts toward
--     no one's quota.
--
-- Operational notes:
--   * The bucket limit cannot exceed the project's global "Upload file size
--     limit" (Dashboard > Storage > Settings; local supabase/config.toml says
--     50MiB). Raise the global limit to >= 100 MiB or 100 MiB videos fail with
--     "The object exceeded the maximum allowed size". (Free-plan projects are
--     capped at 50 MB.)
--   * get_actual_storage_usage and the trigger filter survey-media by owner_id
--     with no index on it (hosted Supabase does not allow DDL on storage.objects).
--     They scan the survey-media rows through the (bucket_id, name) index;
--     fine at survey scale, revisit past ~100k media objects.
--
-- VERIFY AFTER APPLYING (SQL editor, as postgres):
--   -- a) bucket
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'survey-media';
--     -- expect: public = false, 104857600, 16 MIME types
--   -- b) policies (expect exactly 3 rows: DELETE, INSERT, SELECT; no UPDATE)
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE 'survey_media_%' ORDER BY cmd;
--   -- c) path parser (expect the uuid, then NULL, NULL)
--   SELECT public.survey_media_object_document_id('11111111-2222-4333-8444-555555555555/surveyMarker-abc/66666666-7777-4888-9999-000000000000.jpg'),
--          public.survey_media_object_document_id('11111111-2222-4333-8444-555555555555/x.jpg'),
--          public.survey_media_object_document_id('../66666666-7777-4888-9999-000000000000.jpg');
--   -- d) usage is unchanged for every user until media exists (expect 0 rows)
--   SELECT u.id FROM auth.users u
--    WHERE public.get_actual_storage_usage(u.id) <> COALESCE((
--          SELECT SUM((o.metadata->>'size')::bigint) FROM storage.objects o
--           WHERE o.bucket_id = 'documents' AND o.name LIKE u.id::text || '/%'), 0)
--          + COALESCE((
--          SELECT SUM((o.metadata->>'size')::bigint) FROM storage.objects o
--           WHERE o.bucket_id = 'survey-media' AND o.owner_id = u.id::text), 0);
--   -- e) the byte-gate trigger is still attached (expect 1 row, enabled 'O')
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'storage.objects'::regclass AND tgname = 'enforce_documents_storage_quota';
--   -- f) orphan finder is service-only (expect false, false, true) and empty
--   SELECT has_function_privilege('authenticated', 'public.list_orphaned_survey_media(integer)', 'EXECUTE'),
--          has_function_privilege('anon', 'public.list_orphaned_survey_media(integer)', 'EXECUTE'),
--          has_function_privilege('service_role', 'public.list_orphaned_survey_media(integer)', 'EXECUTE');
--   SELECT * FROM public.list_orphaned_survey_media(10);
--   -- g) after adding one photo in the app: the object carries its uploader
--   --    and real size, and the uploader's usage went up by that size
--   SELECT name, owner_id, metadata->>'size' AS size, metadata->>'mimetype' AS mime
--     FROM storage.objects WHERE bucket_id = 'survey-media'
--    ORDER BY created_at DESC LIMIT 5;
-- Then in the app: add a photo as an editor (works), open the marker as a
-- viewer collaborator (photo shows), try to add one as a viewer (refused).

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
  104857600,
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
