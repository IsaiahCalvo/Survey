-- PROPOSED — NOT APPLIED. Needs the owner's go-ahead before it touches prod
-- "Survey" (hand-managed; apply via the Management API per
-- reference_supabase_prod_management, then record the version).
-- Deliberately kept OUT of supabase/migrations/ so no `db push` can run it.
--
-- Shared (cloud) thumbnails — the cross-device half of the 2026-09-23
-- thumbnail strategy.
--
-- What already ships without this (branch claude/w14-thumbnails):
--   * the open viewer re-draws page 1 WITH markup after edits settle and
--     caches it on that device, keyed by a content signature;
--   * sibling tabs/windows on the same device update instantly (pushed);
--   * an idle one-at-a-time backfill fills missing thumbnails on each device,
--     reading only page 1's bytes (HTTP ranges).
-- What it cannot do without this: show YOUR markup on ANOTHER device, or a
-- collaborator's edits on yours, without that device opening the document.
-- Nothing shared exists today that can hold an image: the only private bucket
-- ("documents") allows PDF/Excel types only, and collaborators may read an
-- object there only when its name equals a documents.file_path.
--
-- Design:
--   1. private bucket "thumbnails", images only, 512KB cap; one object per
--      document at "<document_id>.webp" (overwritten in place);
--   2. table document_thumbnails: which content signature that object shows
--      (the same signature the app already computes — see
--      src/services/thumbnailSignature.js). The Documents list embeds it in
--      its existing documents query (`select('*, document_thumbnails(signature)')`),
--      so staleness costs ZERO extra requests; a row downloads the ~15-60KB
--      image only when the signature differs from the one cached locally;
--   3. writes go through one SECURITY DEFINER function gated on editor
--      access, so collaborators' edits refresh the thumbnail for everyone;
--      readers need viewer access. No triggers on the annotation hot path.
--   Storage quota: thumbnails live in storage.objects, so if
--   get_actual_storage_usage sums every bucket they count toward the owner's
--   quota — roughly 30KB per document. Exclude bucket 'thumbnails' there if
--   that is unwanted.

BEGIN;

-- 1. Bucket -----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('thumbnails', 'thumbnails', false, 524288, ARRAY['image/webp', 'image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Object name -> document id, NULL for anything that is not "<uuid>.webp|jpg".
-- A plain function (no table access) so the policies below never subquery
-- storage.objects from a policy on storage.objects.
CREATE OR REPLACE FUNCTION public.thumbnail_object_document_id(object_name text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN object_name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg)$'
    THEN substring(object_name from 1 for 36)::uuid
    ELSE NULL
  END
$$;

DROP POLICY IF EXISTS thumbnails_read ON storage.objects;
CREATE POLICY thumbnails_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND public.user_can_access_document(public.thumbnail_object_document_id(name), 'viewer')
  );

DROP POLICY IF EXISTS thumbnails_insert ON storage.objects;
CREATE POLICY thumbnails_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND public.user_can_access_document(public.thumbnail_object_document_id(name), 'editor')
  );

DROP POLICY IF EXISTS thumbnails_update ON storage.objects;
CREATE POLICY thumbnails_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND public.user_can_access_document(public.thumbnail_object_document_id(name), 'editor')
  )
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND public.user_can_access_document(public.thumbnail_object_document_id(name), 'editor')
  );
-- No DELETE policy: the object goes away with the document (cleanup below).

-- 2. Which content the stored image shows -------------------------------------
CREATE TABLE IF NOT EXISTS public.document_thumbnails (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  signature   text NOT NULL CHECK (length(signature) BETWEEN 1 AND 64),
  width       integer CHECK (width BETWEEN 1 AND 4096),
  height      integer CHECK (height BETWEEN 1 AND 4096),
  bytes       integer CHECK (bytes BETWEEN 1 AND 524288),
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_thumbnails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_thumbnails_read ON public.document_thumbnails;
CREATE POLICY document_thumbnails_read ON public.document_thumbnails
  FOR SELECT TO authenticated
  USING (public.user_can_access_document(document_id, 'viewer'));
-- No insert/update/delete policies: writes only through the function below.

REVOKE ALL ON public.document_thumbnails FROM anon;
GRANT SELECT ON public.document_thumbnails TO authenticated;

-- 3. The one write path ---------------------------------------------------------
-- Called by the app right after it uploads "<document_id>.webp". Idempotent
-- (an unchanged signature writes nothing). Last writer wins: every writer is a
-- viewer that just rendered the document's real current content.
CREATE OR REPLACE FUNCTION public.set_document_thumbnail(
  p_document_id uuid,
  p_signature text,
  p_width integer,
  p_height integer,
  p_bytes integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.document_thumbnails AS t (document_id, signature, width, height, bytes, updated_by, updated_at)
  VALUES (p_document_id, p_signature, p_width, p_height, p_bytes, auth.uid(), now())
  ON CONFLICT (document_id) DO UPDATE
    SET signature = EXCLUDED.signature,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        bytes = EXCLUDED.bytes,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    WHERE t.signature IS DISTINCT FROM EXCLUDED.signature;
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_thumbnail(uuid, text, integer, integer, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_document_thumbnail(uuid, text, integer, integer, integer) TO authenticated;

COMMIT;

-- Follow-ups outside this file (app side, small):
--   * viewer capture: after the local write, upload the same WebP to
--     thumbnails/<document_id>.webp (upsert) and call set_document_thumbnail;
--   * backfill: before rendering from the PDF, fetch the cloud image when the
--     embedded signature exists (15-60KB instead of page-1 PDF bytes); after a
--     page-only render, do NOT publish it (a bare page must never overwrite a
--     marked-up cloud image);
--   * document hard-delete / archive purge: also remove thumbnails/<id>.webp
--     (the table row cascades on its own).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.set_document_thumbnail(uuid, text, integer, integer, integer);
--   DROP TABLE IF EXISTS public.document_thumbnails;
--   DROP POLICY IF EXISTS thumbnails_read ON storage.objects;
--   DROP POLICY IF EXISTS thumbnails_insert ON storage.objects;
--   DROP POLICY IF EXISTS thumbnails_update ON storage.objects;
--   DROP FUNCTION IF EXISTS public.thumbnail_object_document_id(text);
--   -- empty the bucket in the dashboard, then: DELETE FROM storage.buckets WHERE id = 'thumbnails';
