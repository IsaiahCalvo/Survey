-- Owner-approved 2026-10-13 ("Yes, apply it"): page edits get their own stored
-- file, so editing pages of a PDF shared by two projects no longer changes the
-- other project's copy. Applied to production 2026-10-13 (version
-- 20261013150748).
--
-- Relaxes 20260703020000 (documents.file_path immutable) by exactly one case:
-- the document's OWNER may repoint the row at an object in THEIR OWN storage
-- folder. That cannot reopen the 2026-07-03 IDOR (repointing at another
-- user's object): the new path must start with the caller's own uid.
CREATE OR REPLACE FUNCTION public.enforce_documents_file_path_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.file_path IS DISTINCT FROM OLD.file_path
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NOT NULL
       AND OLD.user_id = auth.uid()
       AND NEW.user_id = OLD.user_id
       AND split_part(COALESCE(NEW.file_path, ''), '/', 1) = auth.uid()::text
       AND position('..' IN NEW.file_path) = 0 THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'documents.file_path is immutable (set once at upload)';
  END IF;
  RETURN NEW;
END;
$$;
