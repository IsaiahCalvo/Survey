-- Excel sync audit W4 (2026-10-29): record where a registered workbook really lives.
--
-- kal308_apply_changeset only syncs a SHARED survey (more than one active collaborator)
-- when the active registration is capability_tier 'business' with Graph drive + item ids
-- (PLAN-EXCEL-SECURITY-V1 step 6). The desktop app registers the workbook BEFORE it is
-- saved: a first OneDrive/SharePoint export does not know its drive or item yet, so it
-- registered as 'local' with no ids, and every Excel change on a shared survey went to
-- review. This RPC lets the app bind the drive, item and tier once the upload has
-- returned them (from Microsoft's own driveItem.parentReference).
--
-- Same trust anchor as kal307_register_workbook (the authorised role supplies the Graph
-- identity). Tighter than it on two points:
--   * only the document owner or the person who made the registration may bind it, so an
--     editor cannot upgrade an owner's local workbook to 'business';
--   * a registration already bound to one Graph item cannot be moved to another.

CREATE OR REPLACE FUNCTION public.kal307_bind_workbook_location(
  p_document_id     UUID,
  p_template_id     TEXT,
  p_workbook_id     TEXT,
  p_graph_drive_id  TEXT,
  p_graph_item_id   TEXT,
  p_capability_tier TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_reg      RECORD;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'kal307: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal307: insufficient role — editor or owner required';
  END IF;
  IF p_capability_tier NOT IN ('personal', 'business') THEN
    RAISE EXCEPTION 'kal307: invalid capability tier %', p_capability_tier;
  END IF;
  IF COALESCE(btrim(p_graph_drive_id), '') = '' OR COALESCE(btrim(p_graph_item_id), '') = '' THEN
    RAISE EXCEPTION 'kal307: graph drive id and item id are required';
  END IF;

  SELECT r.id, r.registered_by, r.graph_item_id INTO v_reg
    FROM public.excel_workbook_registrations r
   WHERE r.document_id = p_document_id
     AND r.template_id = p_template_id
     AND r.workbook_id = p_workbook_id
     AND r.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_reg.registered_by IS DISTINCT FROM v_actor_id
     AND NOT public.user_can_access_document(p_document_id, 'owner') THEN
    RAISE EXCEPTION 'kal307: only the document owner or the person who linked this workbook can set its location';
  END IF;

  IF COALESCE(v_reg.graph_item_id, '') <> '' AND v_reg.graph_item_id <> p_graph_item_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.excel_workbook_registrations
     SET graph_drive_id  = p_graph_drive_id,
         graph_item_id   = p_graph_item_id,
         capability_tier = p_capability_tier
   WHERE id = v_reg.id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.kal307_bind_workbook_location(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kal307_bind_workbook_location(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.kal307_bind_workbook_location(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.kal307_bind_workbook_location(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Excel audit W4: bind the active registration to the Graph drive/item it was saved to, '
  'with the tier from Microsoft''s driveType. Owner or registrant only; never moves an '
  'already-bound registration to another item.';
