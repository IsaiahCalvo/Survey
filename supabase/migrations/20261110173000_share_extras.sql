-- Share dialog extras (Nightly flag share-extras): Drawboard's share dialog
-- lists who is on a document with when each person last opened it, and sorts
-- by Activity. document_opens (20261110171000) is private to each person, so
-- this one call hands a member the last-opened time of the document's owner
-- and active collaborators, and nothing else. Guest-link sessions get nothing.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_document_member_activity(doc_id uuid)
RETURNS TABLE (user_id uuid, last_opened_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL
     OR public.is_guest_session()
     OR NOT public.user_can_access_document(doc_id, 'viewer') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.user_id, o.opened_at
    FROM public.document_opens o
   WHERE o.document_id = doc_id
     AND (
       o.user_id = (SELECT d.user_id FROM public.documents d WHERE d.id = doc_id)
       OR EXISTS (
         SELECT 1 FROM public.document_collaborators c
          WHERE c.document_id = doc_id AND c.user_id = o.user_id AND c.status = 'active'
       )
     );
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_member_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_member_activity(uuid) TO authenticated;

INSERT INTO public.feature_flags (key, mode, description) VALUES
  ('share-extras', 'off', 'Share dialog: owner row with (you), sort by Role / Name / Activity, personal message on email invites.')
ON CONFLICT (key) DO NOTHING;

COMMIT;
