-- Rollback for: supabase/proposed/20261013_fork_document_file.sql
-- Date: 2026-10-13
-- Drops fork_document_file and restores enforce_documents_file_path_immutable
-- to its 20260703020000 body. Idempotent.
--
-- Rows already moved onto `<owner>/<document id>.pdf` keep that path (it is
-- their own object; moving them back would make them share again). After this
-- rollback the app falls back to saving page edits in place, which is the old
-- shared-object behaviour.

BEGIN;

DROP FUNCTION IF EXISTS public.fork_document_file(uuid, text);

CREATE OR REPLACE FUNCTION public.enforce_documents_file_path_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.file_path IS DISTINCT FROM OLD.file_path
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'documents.file_path is immutable (set once at upload)';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
