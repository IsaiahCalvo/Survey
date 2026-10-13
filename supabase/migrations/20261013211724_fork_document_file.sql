-- fork_document_file: a page edit never rewrites a stored PDF another
-- document shares (PR #812).
--
-- Owner-approved 2026-10-13 ("Yes, use #812"). Applied to production
-- 2026-10-13 as version 20261013211724 (name fork_document_file), so
-- `supabase db push` (deploy-production.yml) never runs this file there; it is
-- the exact applied SQL, kept so a database that replays the migrations gets
-- the same function. It supersedes the owner-repoint rule of 20261013150748
-- (enforce_documents_file_path_immutable is replaced again below: a client
-- UPDATE of file_path is refused once more; only this function may move a
-- row, onto `<owner>/<document id>.pdf`).
-- Rollback: supabase/rollbacks/20261013_fork_document_file.down.sql
-- Tested against a local Postgres: tests/forkDocumentFilePostgres.test.mjs
--
-- THE PROBLEM
-- -----------
-- Uploads used to be stored at `<user>/<sha256>.pdf`. The same file uploaded
-- into two projects gives two documents rows on ONE storage object, and a page
-- edit (duplicate / delete / paste / reorder) overwrites the open document's
-- object in place, so every other document on that object silently gets the
-- edited pages. New uploads now get their own object (`<user>/<document id>.pdf`,
-- client change in the same branch), but rows already sharing an object stay
-- shared, and documents.file_path is immutable for clients
-- (20260703020000_documents_file_path_immutable.sql), so the client cannot move
-- a row onto a new object by itself.
--
-- WHAT THIS DOES
-- --------------
--   1. public.fork_document_file(p_document_id, p_content_sha256): the
--      document's OWNER moves the row onto its own object
--      `<owner id>/<document id>.pdf` (which the client has just uploaded) and
--      records the new bytes' fingerprint. The client calls it only when another
--      row still reads the old object (src/services/documentFileReplace.js).
--   2. enforce_documents_file_path_immutable() lets file_path change inside
--      that function only, via a transaction-local flag naming the one row.
--
-- WHY IT IS SAFE (the 20260703020000 IDOR stays closed)
-- ------------------------------------------------------
--   * The caller cannot choose the path. It is always
--     `<auth.uid()>/<p_document_id>.pdf`, and the caller must own the row, so
--     the row can only ever point INTO THE CALLER'S OWN storage folder — never
--     at another user's object, which was the attack 20260703020000 closed.
--   * The object must already exist in the documents bucket (the caller's
--     upload, which the storage policies only allow in their own folder), and
--     no other documents row may use that path.
--   * The flag is set with set_config(..., is_local => true) inside this
--     SECURITY DEFINER function and cleared right after its one UPDATE.
--     PostgREST gives clients no way to set arbitrary settings, so a plain
--     client UPDATE of file_path is still refused.
--   * The fingerprint must look like a SHA-256 hex digest (or be null). The
--     server cannot hash the bytes (SQL cannot read Storage), same as the
--     content_sha256 the client already sends on INSERT.
--   * If the fingerprint is already another document's in the same project
--     (unique index documents_user_project_sha_uidx) it is stored as NULL
--     instead of failing the save.
--
-- What it does not do: copy bytes (SQL cannot). Rows that share an object stay
-- shared until one of them is page-edited; that edit forks it. The old object
-- stays: the other rows still read it, and the delete flow / purge sweep
-- already remove an object only once no row points at it.

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
