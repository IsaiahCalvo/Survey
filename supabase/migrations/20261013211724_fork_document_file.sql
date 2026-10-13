-- Owner-approved 2026-10-13 ("Yes, use #812"). Applied to production
-- 2026-10-13 as version 20261013211724, from PR #812
-- (supabase/proposed/20261013_fork_document_file.sql there). Replaces the looser
-- owner-repoint rule of 20261013150748: documents.file_path changes only inside
-- fork_document_file, which picks the path itself (<owner>/<document id>.pdf).
-- The app code that calls it arrives with #812; until then nothing calls it.

CREATE OR REPLACE FUNCTION public.enforce_documents_file_path_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.file_path IS DISTINCT FROM OLD.file_path
     AND COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(current_setting('app.fork_document_file_id', true), '') <> OLD.id::text THEN
    RAISE EXCEPTION 'documents.file_path is immutable (set once at upload)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fork_document_file(
  p_document_id uuid,
  p_content_sha256 text DEFAULT NULL
)
RETURNS public.documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.documents;
  v_path text;
  v_sha text := lower(NULLIF(btrim(p_content_sha256), ''));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF v_sha IS NOT NULL AND v_sha !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'content_sha256 must be a SHA-256 hex digest' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_doc FROM public.documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.user_id IS DISTINCT FROM v_uid THEN
    -- Same answer for "no such row" and "not yours": no existence oracle.
    RAISE EXCEPTION 'Document not found' USING ERRCODE = '42501';
  END IF;

  v_path := v_uid::text || '/' || p_document_id::text || '.pdf';

  IF NOT EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'documents' AND name = v_path
  ) THEN
    RAISE EXCEPTION 'Upload the document''s own copy before moving it' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents WHERE file_path = v_path AND id <> p_document_id
  ) THEN
    RAISE EXCEPTION 'That storage object belongs to another document' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.fork_document_file_id', p_document_id::text, true);
  BEGIN
    UPDATE public.documents
       SET file_path = v_path, content_sha256 = v_sha
     WHERE id = p_document_id
    RETURNING * INTO v_doc;
  EXCEPTION WHEN unique_violation THEN
    -- These bytes are already another document in the same project.
    UPDATE public.documents
       SET file_path = v_path, content_sha256 = NULL
     WHERE id = p_document_id
    RETURNING * INTO v_doc;
  END;
  PERFORM set_config('app.fork_document_file_id', '', true);

  RETURN v_doc;
END;
$$;

REVOKE ALL ON FUNCTION public.fork_document_file(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fork_document_file(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fork_document_file(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.fork_document_file(uuid, text) IS
  'Owner-only. Moves a document row onto its own storage object <owner>/<document id>.pdf (already uploaded) and records its fingerprint, so a page edit never rewrites an object another document shares. 2026-10-13.';
