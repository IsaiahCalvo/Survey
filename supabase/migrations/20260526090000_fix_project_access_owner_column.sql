-- KAL hotfix: project ownership uses projects.user_id, not projects.created_by.
--
-- 20260521000000_kal31_remove_commenter_role.sql accidentally rewrote
-- user_can_access_project() to check public.projects.created_by. The projects
-- table does not have that column; inserting a project then fails when the
-- trigger tries to add the owner row to project_collaborators and RLS calls
-- this helper. Keep the KAL-31 role hierarchy, but restore the canonical owner
-- check to public.projects.user_id.

CREATE OR REPLACE FUNCTION public.user_can_access_project(proj_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_role TEXT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.projects
         WHERE id = proj_id AND user_id = auth.uid()
    ) THEN
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

COMMENT ON FUNCTION public.user_can_access_project(UUID, TEXT) IS
  'KAL hotfix 2026-05-26 — project owner check uses projects.user_id; role hierarchy is owner > editor > viewer.';
