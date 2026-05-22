-- KAL-49 hotfix dependency — restore public.user_can_access_document().
--
-- A remote-only migration on this branch's target environment overwrote
-- `user_can_access_document` to reference `documents.created_by`, a column
-- that does not exist on the live `documents` table (Postgres error 42703
-- with hint "Perhaps you meant to reference the column documents.created_at").
-- The breakage blocks every non-owner SELECT/INSERT/UPDATE/DELETE on documents
-- and document_annotations, which transitively blocks the KAL-49 verification
-- harness from proving the lock RLS deny path on the editor account.
--
-- This migration restores the canonical body from migration 20241230000002
-- (Phase 1 collaborator model) without touching any other function. It's
-- idempotent — the function key is `(uuid, text)` and we CREATE OR REPLACE.
-- If a follow-up migration re-introduces `created_by` semantics intentionally,
-- it must also add the column; until then this restores the contract every
-- downstream RLS policy depends on.

BEGIN;

CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    doc_owner_id UUID;
    user_role TEXT;
BEGIN
    -- Document ownership: `documents.user_id` is the canonical owner field.
    -- Direct lookup rather than the older project-join path because some
    -- documents are not linked to a project (project_id is nullable on the
    -- shared/disposable test rows the verifier creates).
    SELECT user_id INTO doc_owner_id
    FROM public.documents
    WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    -- Collaborator path: check document_collaborators with status='active'.
    SELECT role INTO user_role
    FROM public.document_collaborators
    WHERE document_id = doc_id
      AND user_id = auth.uid()
      AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer'    THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor'    THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'     THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_document(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.user_can_access_document(UUID, TEXT) IS
  'KAL-49 hotfix: restored canonical body — owner check via documents.user_id; collaborator check via document_collaborators(role, status=active).';

COMMIT;
