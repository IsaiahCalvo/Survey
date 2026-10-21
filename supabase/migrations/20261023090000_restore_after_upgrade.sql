-- Bring back what a Free downgrade archived when the person upgrades again.
--
-- `archived` on projects/documents is shared: handle_downgrade_to_free sets it
-- on overage, but the app also sets it when a person deletes a document
-- (useDatabase deleteDocument). An upgrade may only undo the downgrade, never
-- resurrect something the person removed, so the downgrade now marks the rows
-- it archived and restore_after_upgrade touches only marked rows.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS archived_by_downgrade BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS archived_by_downgrade BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN public.projects.archived_by_downgrade IS
  'True while archived only because a downgrade to Free put the project over the limit; restore_after_upgrade clears it.';
COMMENT ON COLUMN public.documents.archived_by_downgrade IS
  'True while archived only because a downgrade to Free put the document over the limit; restore_after_upgrade clears it.';

-- Any other change to `archived` (the person reviving or deleting the row)
-- hands the row back to the person, so a later upgrade leaves it alone. The
-- downgrade and restore functions change the marker in their own statements,
-- which this leaves as they set it.
CREATE OR REPLACE FUNCTION public.clear_archived_by_downgrade()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.archived IS DISTINCT FROM OLD.archived
     AND NEW.archived_by_downgrade IS NOT DISTINCT FROM OLD.archived_by_downgrade THEN
    NEW.archived_by_downgrade := FALSE;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_archived_by_downgrade() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS projects_clear_archived_by_downgrade ON public.projects;
CREATE TRIGGER projects_clear_archived_by_downgrade
  BEFORE UPDATE OF archived ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.clear_archived_by_downgrade();
DROP TRIGGER IF EXISTS documents_clear_archived_by_downgrade ON public.documents;
CREATE TRIGGER documents_clear_archived_by_downgrade
  BEFORE UPDATE OF archived ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.clear_archived_by_downgrade();

-- Same result shape as before; it now also marks the rows it archived. The
-- archive_excess_* helpers are left as they are.
CREATE OR REPLACE FUNCTION public.handle_downgrade_to_free(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_archived_projects JSON;
  v_archived_documents JSON;
BEGIN
  -- Free tier: 1 project
  WITH archived_projs AS (
    SELECT * FROM public.archive_excess_projects(p_user_id, 1)
  )
  SELECT json_agg(row_to_json(archived_projs.*)) INTO v_archived_projects
  FROM archived_projs;

  UPDATE public.projects
  SET archived_by_downgrade = TRUE
  WHERE user_id = p_user_id
    AND id IN (
      SELECT (e->>'archived_project_id')::uuid
      FROM json_array_elements(COALESCE(v_archived_projects, '[]'::json)) AS e
    );

  -- Free tier: 5 documents
  WITH archived_docs AS (
    SELECT * FROM public.archive_excess_documents(p_user_id, 5)
  )
  SELECT json_agg(row_to_json(archived_docs.*)) INTO v_archived_documents
  FROM archived_docs;

  UPDATE public.documents
  SET archived_by_downgrade = TRUE
  WHERE user_id = p_user_id
    AND id IN (
      SELECT (e->>'archived_document_id')::uuid
      FROM json_array_elements(COALESCE(v_archived_documents, '[]'::json)) AS e
    );

  RETURN json_build_object(
    'user_id', p_user_id,
    'archived_projects', COALESCE(v_archived_projects, '[]'::json),
    'archived_documents', COALESCE(v_archived_documents, '[]'::json),
    'projects_archived_count', COALESCE(json_array_length(v_archived_projects), 0),
    'documents_archived_count', COALESCE(json_array_length(v_archived_documents), 0)
  );
END;
$$;

-- Undo a downgrade: un-archive only what the downgrade archived.
CREATE OR REPLACE FUNCTION public.restore_after_upgrade(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_projects INTEGER;
  v_documents INTEGER;
BEGIN
  UPDATE public.projects
  SET archived = FALSE, archived_by_downgrade = FALSE
  WHERE user_id = p_user_id AND archived_by_downgrade;
  GET DIAGNOSTICS v_projects = ROW_COUNT;

  UPDATE public.documents
  SET archived = FALSE, archived_by_downgrade = FALSE
  WHERE user_id = p_user_id AND archived_by_downgrade;
  GET DIAGNOSTICS v_documents = ROW_COUNT;

  RETURN json_build_object(
    'user_id', p_user_id,
    'projects_restored_count', v_projects,
    'documents_restored_count', v_documents
  );
END;
$$;
COMMENT ON FUNCTION public.restore_after_upgrade(UUID) IS
  'Upgrade flow: un-archives the projects and documents a downgrade to Free archived (archived_by_downgrade), nothing else';

-- Like handle_downgrade_to_free, these take any user id: only the Stripe
-- webhook (service role) may run them.
REVOKE EXECUTE ON FUNCTION public.handle_downgrade_to_free(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_downgrade_to_free(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.restore_after_upgrade(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_after_upgrade(uuid) TO service_role;
