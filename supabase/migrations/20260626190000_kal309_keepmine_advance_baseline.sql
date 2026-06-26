-- 20260626190000_kal309_keepmine_advance_baseline.sql
-- KAL-309 FIX (sibling of the 20260626180000 before/after fix): the conflict-resolution RPC
-- kal309_resolve_materialization_conflict advanced excel_sync_state's stored fingerprints ONLY on
-- 'merged'. On 'keep-app' ("keep mine") the user keeps the APP's version, but the server's stored
-- state still held the Excel value the apply had committed — so server and client diverged and the
-- user's NEXT edit to that marker false-conflicted. ('take-excel' is fine: the client adopts the
-- Excel value, which already equals the stored state.) Fix: also advance on 'keep-app' when the
-- client supplies the kept marker's fingerprints (p_resolved_fingerprints). The client now computes
-- and passes them on keep-app. Body below is the LIVE prod definition with only that guard widened.

CREATE OR REPLACE FUNCTION public.kal309_resolve_materialization_conflict(p_document_id uuid, p_template_id text, p_op_uuid uuid, p_resolution text, p_resolved_fingerprints jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_op            RECORD;
  v_op_new        TEXT;
  v_state_new     TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'kal309: not authenticated';
  END IF;
  IF NOT public.user_can_access_document(p_document_id, 'editor') THEN
    RAISE EXCEPTION 'kal309: insufficient role — editor or owner required';
  END IF;
  IF p_resolution NOT IN ('keep-app','take-excel','merged') THEN
    RAISE EXCEPTION 'kal309: invalid resolution %', p_resolution;
  END IF;

  SELECT o.id, o.scope_id, o.marker_annotation_id, o.op_status, o.workbook_generation INTO v_op
    FROM public.excel_sync_ops o
   WHERE o.op_uuid = p_op_uuid
     AND o.document_id = p_document_id
     AND o.template_id = p_template_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Only resolve an op that is actually in conflict-review.
  IF v_op.op_status <> 'client_conflict_review' THEN
    RETURN FALSE;
  END IF;

  IF p_resolution = 'take-excel' THEN
    -- The Excel value wins; the client WILL re-materialize.  Fix 8 / build note 3 — reload-safe:
    -- set the OP back to 'accepted' (NOT 'resolved') so kal309_fetch_since re-surfaces it and the
    -- reducer re-materializes it after a reload; state → 'accepted' too (then the normal
    -- materialized ack flips both once the client re-applies).  Using 'resolved' here would make
    -- fetch_since skip the op on reload, silently dropping the take-excel result.
    v_op_new    := 'accepted';
    v_state_new := 'accepted';
  ELSE
    -- keep-app / merged: nothing is re-applied to app fields; op → resolved, state → materialized.
    v_op_new    := 'resolved';
    v_state_new := 'materialized';
  END IF;

  UPDATE public.excel_sync_ops
     SET op_status = v_op_new
   WHERE op_uuid = p_op_uuid;

  UPDATE public.excel_sync_state
     SET materialization_status = v_state_new,
         op_status              = v_op_new,
         -- merged: write the post-merge fingerprints so the next TOCTOU diff is against
         -- the merged baseline.
         identity_vector_fingerprint = CASE
           WHEN p_resolution IN ('merged','keep-app') AND p_resolved_fingerprints IS NOT NULL
             THEN COALESCE(p_resolved_fingerprints #>> '{identityVector}', identity_vector_fingerprint)
           ELSE identity_vector_fingerprint END,
         field_fingerprints = CASE
           WHEN p_resolution IN ('merged','keep-app') AND p_resolved_fingerprints IS NOT NULL
             THEN COALESCE(p_resolved_fingerprints #> '{fields}', field_fingerprints)
           ELSE field_fingerprints END,
         updated_at = now()
   WHERE document_id = p_document_id AND template_id = p_template_id
     AND scope_id = v_op.scope_id AND marker_annotation_id = v_op.marker_annotation_id;

  -- Audit the resolution (content-free).
  INSERT INTO public.excel_sync_audit(document_id, template_id, workbook_generation,
    actor_id, capability_tier, client_change_set_id, marker_annotation_id, row_outcome)
    VALUES (p_document_id, p_template_id, v_op.workbook_generation, auth.uid(),
            'resolve', p_op_uuid::text, v_op.marker_annotation_id, 'review');

  RETURN TRUE;
END;
$function$;
