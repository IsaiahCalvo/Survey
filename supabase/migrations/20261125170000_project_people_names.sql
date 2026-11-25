-- Audit round 5 (two people), #2 and #5 (2026-11-24): team lists named each
-- person by the email stored on their project_collaborators row, so the owner
-- read as "Teammate" (no email on the owner's row) and others as "qa-c".
-- Comments already read real names through mark_comment_people; this is the
-- same lookup for projects. A caller sees only the people of projects they
-- belong to (owner or active collaborator). Adds a function, changes no data.
CREATE OR REPLACE FUNCTION public.project_people_names(p_project_ids uuid[])
RETURNS TABLE (project_id uuid, user_id uuid, name text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
  IF auth.uid() IS NULL OR p_project_ids IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH mine AS (
    SELECT pid FROM unnest(p_project_ids) AS pid
     WHERE public.project_item_member(pid, auth.uid())
  ),
  people AS (
    SELECT p.id AS pid, p.user_id AS uid FROM public.projects p JOIN mine ON mine.pid = p.id
    UNION
    SELECT c.project_id, c.user_id FROM public.project_collaborators c JOIN mine ON mine.pid = c.project_id
     WHERE c.status = 'active' AND c.user_id IS NOT NULL
  )
  SELECT people.pid,
         u.id,
         NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), '')::text,
         u.email::text
    FROM people
    JOIN auth.users u ON u.id = people.uid;
END;
$$;

REVOKE ALL ON FUNCTION public.project_people_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.project_people_names(uuid[]) TO authenticated;
