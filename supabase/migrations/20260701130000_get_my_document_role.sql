-- Effective-role lookup for the viewer UI (role gating at document open).
-- Same resolution order as user_can_access_document: creator -> direct
-- document_collaborators role -> project_collaborators role -> project
-- creator (implicit owner). Returns NULL when the caller has no access.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_document_role(doc_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    user_role TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT user_id, project_id INTO doc_owner_id, doc_project_id
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN NULL;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN 'owner';
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL AND doc_project_id IS NOT NULL THEN
        SELECT role INTO user_role
          FROM public.project_collaborators
         WHERE project_id = doc_project_id
           AND user_id = auth.uid()
           AND status = 'active';

        IF user_role IS NULL THEN
            SELECT CASE WHEN user_id = auth.uid() THEN 'owner' END INTO user_role
              FROM public.projects
             WHERE id = doc_project_id;
        END IF;
    END IF;

    RETURN user_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_document_role(UUID) TO authenticated;

COMMIT;
