-- ROLLBACK for KAL-426 archive migration.
-- Captured from production (cvamwtpsuvxvjdnotbeg) 2026-08-02 BEFORE applying.
-- Restores the four access-control functions to their pre-migration definitions.
-- Does NOT drop the added columns/indexes (harmless if left) or the new archive RPCs.

CREATE OR REPLACE FUNCTION public.get_my_document_role(doc_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id uuid, required_role text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    doc_owner_id UUID;
    doc_project_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id, project_id INTO doc_owner_id, doc_project_id
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

    -- No direct document role: fall back to project membership.
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
$function$;

CREATE OR REPLACE FUNCTION public.user_can_access_project(proj_id uuid, required_role text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.user_can_access_template(tpl_id uuid, required_role text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    tpl_owner_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id INTO tpl_owner_id
      FROM public.templates
     WHERE id = tpl_id;

    IF tpl_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF tpl_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.template_collaborators
     WHERE template_id = tpl_id
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
$function$;
