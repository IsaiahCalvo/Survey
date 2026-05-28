-- KAL-31 hotfix follow-up — restore canonical bodies for
-- public.user_can_access_document and public.user_can_access_project.
--
-- Background: migration 20260521000000_kal31_remove_commenter_role.sql replaced
-- both helpers with bodies that query `documents.created_by` and
-- `projects.created_by`. Neither table has a `created_by` column — the
-- canonical owner column on both is `user_id`. The earlier hotfix
-- 20260522010000_kal49_fix_user_can_access_document.sql already restored the
-- document helper, but it was overwritten when 20260521000000 was re-applied
-- via `supabase db push --include-all` (out-of-order push). This migration
-- restores both helpers to the canonical user_id-based bodies and is
-- date-stamped after 20260521000000 so the canonical bodies are the last
-- writers.
--
-- Symptom this fixes:
--   PostgREST returns 42703 "column \"created_by\" does not exist" on every
--   SELECT/INSERT/UPDATE/DELETE that flows through these helpers, which
--   transitively breaks template loading, annotation hydrate, history
--   recording, presence, and survey marker drawing.

BEGIN;

-- ---------------------------------------------------------------------------
-- user_can_access_document — owner via documents.user_id; KAL-31 role set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id INTO doc_owner_id
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_document(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.user_can_access_document(UUID, TEXT) IS
  'KAL-31 + KAL-49 restored: owner via documents.user_id; collaborator via document_collaborators(role, status=active). Role hierarchy owner > editor > viewer; commenter removed per KAL-31 spec.';

-- ---------------------------------------------------------------------------
-- user_can_access_project — owner via projects.user_id; KAL-31 role set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_project(proj_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    proj_owner_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id INTO proj_owner_id
      FROM public.projects
     WHERE id = proj_id;

    IF proj_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF proj_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.project_collaborators
     WHERE project_id = proj_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_project(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.user_can_access_project(UUID, TEXT) IS
  'KAL-31 restored: owner via projects.user_id; collaborator via project_collaborators(role, status=active). Role hierarchy owner > editor > viewer.';

COMMIT;
