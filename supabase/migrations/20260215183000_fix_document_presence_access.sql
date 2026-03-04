-- Fix document access checks for docs without a project and tighten presence RLS.
-- This resolves 403 errors on document_presence upserts for "general" documents.

CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
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

    -- Use LEFT JOIN so documents without project_id still resolve creator access.
    SELECT d.project_id, p.user_id, d.user_id
    INTO doc_project_id, doc_owner_id, doc_creator_id
    FROM public.documents d
    LEFT JOIN public.projects p ON p.id = d.project_id
    WHERE d.id = doc_id;

    IF doc_creator_id IS NULL AND doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Project owner has full access.
    IF doc_owner_id = current_user_id THEN
        RETURN TRUE;
    END IF;

    -- Document creator can view/comment/edit.
    IF doc_creator_id = current_user_id THEN
        IF required_role IN ('viewer', 'commenter', 'editor') THEN
            RETURN TRUE;
        END IF;

        -- For docs without a project, creator is effectively owner.
        IF required_role = 'owner' AND doc_project_id IS NULL THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- Collaborator role fallback.
    SELECT dc.role INTO user_role
    FROM public.document_collaborators dc
    WHERE dc.document_id = doc_id
      AND dc.user_id = current_user_id
      AND dc.status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner' THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

DROP POLICY IF EXISTS "Users can insert own presence" ON public.document_presence;
CREATE POLICY "Users can insert own presence"
    ON public.document_presence FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND user_can_access_document(document_id, 'viewer')
    );

DROP POLICY IF EXISTS "Users can update own presence" ON public.document_presence;
CREATE POLICY "Users can update own presence"
    ON public.document_presence FOR UPDATE
    USING (
        auth.uid() = user_id
        AND user_can_access_document(document_id, 'viewer')
    );
