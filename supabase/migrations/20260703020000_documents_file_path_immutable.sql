-- SECURITY (2026-07-03) — fix cross-tenant file-read IDOR via documents.file_path.
--
-- The "Users can update own documents" policy has a USING clause but no
-- WITH CHECK, so a user (or promoted co-owner) can repoint their OWN document
-- row's `file_path` at ANOTHER user's storage object:
--   supabase.from('documents').update({ file_path: '<victim-uid>/<victim-file>.pdf' }).eq('id', <own-doc-id>)
-- and then call downloadDocument(...) on that path. The collaborator storage-read
-- policy authorizes the read against the attacker's own (now-doctored) row, so
-- they receive the victim's actual PDF bytes — a full cross-tenant confidentiality
-- break. file_path values are visible in plaintext in ordinary documents SELECTs.
--
-- file_path is assigned once at upload and is never legitimately changed by the
-- app (renames touch `name`, not `file_path`). Forbid client-side changes to it
-- with a BEFORE UPDATE trigger; the service_role (stripe/webhook/admin/migrations)
-- can still change it if ever needed.

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

DROP TRIGGER IF EXISTS trg_documents_file_path_immutable ON public.documents;
CREATE TRIGGER trg_documents_file_path_immutable
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_documents_file_path_immutable();
