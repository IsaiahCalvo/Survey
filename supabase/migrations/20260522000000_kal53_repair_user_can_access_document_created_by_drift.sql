-- KAL-53 — Repair documents.created_by schema drift in user_can_access_document.
--
-- Problem
-- -------
-- The remote production project (cvamwtpsuvxvjdnotbeg) carries a stale revision
-- of public.user_can_access_document(uuid, text) whose body references a
-- nonexistent column `documents.created_by`. The canonical schema uses
-- `documents.user_id` as the creator column (and `projects.user_id` as the
-- project-owner column). Every local migration since 20241230000002 defines
-- the helper against `d.user_id` / `p.user_id`, so the local repo is correct
-- and the live database has drifted.
--
-- Symptoms observed during KAL-45 / KAL-24 verification:
--   * INSERT/SELECT into public.documents from real authenticated clients
--     produced Postgres 42703 `column "created_by" does not exist`.
--   * storage.objects SELECT on the documents bucket hit the same 42703 via
--     the policy "Document collaborators can read accessible document files",
--     which calls public.user_can_access_document(d.id, 'viewer').
--
-- Resolution strategy
-- -------------------
-- Re-issue the canonical Phase-28 helper body (20260504000000) so the live
-- function definition matches the rest of the schema. This is a forward-only
-- repair — no historical migration is edited. Idempotent: CREATE OR REPLACE,
-- DROP POLICY IF EXISTS + CREATE POLICY, CREATE INDEX IF NOT EXISTS.
--
-- We additionally:
--   * Re-pin the SELECT policy on public.documents to the dual-path form
--     (auth.uid() = user_id OR user_can_access_document(...)) so owners keep
--     direct SELECT access on INSERT ... RETURNING (Fix 26 live).
--   * Re-pin the storage.objects collaborator-read policy so it explicitly
--     references documents.user_id semantics through the helper, never a
--     direct created_by column.
--   * Re-create the documents(user_id) and document_collaborators(user_id,
--     document_id) indexes the helper relies on (Phase 28 Pitfall 3 defense)
--     in case the live DB lost them along with the function drift.

BEGIN;

-- ============================================================================
-- Section 1 — Canonical user_can_access_document body (matches Phase 28 local
-- migration 20260504000000_phase28_transport_auth_validator.sql verbatim).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
    doc_project_id UUID;
    doc_owner_id UUID;
    doc_creator_id UUID;
    current_user_id UUID;
    user_role TEXT;
BEGIN
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- LEFT JOIN: documents without project_id still resolve creator access.
    -- Canonical creator column is documents.user_id; project owner column is
    -- projects.user_id. Neither table has a `created_by` column.
    SELECT d.project_id, p.user_id, d.user_id
    INTO doc_project_id, doc_owner_id, doc_creator_id
    FROM public.documents d
    LEFT JOIN public.projects p ON p.id = d.project_id
    WHERE d.id = doc_id;

    IF doc_creator_id IS NULL AND doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Project owner has full access (owner fast path).
    IF doc_owner_id = current_user_id THEN
        RETURN TRUE;
    END IF;

    -- Document creator can view/comment/edit. For project-less docs creator = owner.
    IF doc_creator_id = current_user_id THEN
        IF required_role IN ('viewer', 'commenter', 'editor') THEN
            RETURN TRUE;
        END IF;
        IF required_role = 'owner' AND doc_project_id IS NULL THEN
            RETURN TRUE;
        END IF;
    END IF;

    IF to_regclass('public.document_collaborators') IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT dc.role INTO user_role
    FROM public.document_collaborators dc
    WHERE dc.document_id = doc_id
      AND dc.user_id = current_user_id
      AND dc.status = 'active';

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

COMMENT ON FUNCTION public.user_can_access_document(UUID, TEXT) IS
  'KAL-53 repair (2026-05-22) — restores the Phase 28 canonical body that references documents.user_id and projects.user_id. The previous live revision referenced documents.created_by which never existed in this schema, breaking real cloud uploads with Postgres 42703. STABLE + SECURITY DEFINER + SET search_path = '''' preserved (Pitfall 3 hot path + search-path security posture from 20260211224035).';

-- ============================================================================
-- Section 2 — Re-pin Pitfall 3 indexes (in case live DB lost them).
-- ============================================================================
CREATE INDEX IF NOT EXISTS documents_user_id_idx
  ON public.documents (user_id);

DO $idx$
BEGIN
  IF to_regclass('public.document_collaborators') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS document_collaborators_user_doc_idx
      ON public.document_collaborators (user_id, document_id);
  END IF;
END
$idx$;

-- ============================================================================
-- Section 3 — Re-pin documents SELECT policy (owner direct + helper fallback).
-- Mirrors 20260513013000_fix_document_insert_returning_select_policy.sql so the
-- live DB cannot diverge from the documented contract.
-- ============================================================================
DROP POLICY IF EXISTS "Users can view accessible documents" ON public.documents;
CREATE POLICY "Users can view accessible documents"
  ON public.documents
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.user_can_access_document(id, 'viewer')
  );

COMMENT ON POLICY "Users can view accessible documents" ON public.documents IS
  'KAL-53 repair — owner direct fast path via documents.user_id, collaborator path via user_can_access_document. Never references created_by.';

-- ============================================================================
-- Section 4 — Re-pin storage.objects collaborator-read policy. Mirrors
-- 20260513003000_allow_collaborators_to_read_document_storage.sql.
-- ============================================================================
DROP POLICY IF EXISTS "Document collaborators can read accessible document files"
  ON storage.objects;

CREATE POLICY "Document collaborators can read accessible document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.user_can_access_document(d.id, 'viewer')
    )
  );

COMMIT;
