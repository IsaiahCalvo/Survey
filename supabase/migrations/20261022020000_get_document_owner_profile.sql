-- Owner name/email for the Documents preview "Team" list. Non-owners cannot
-- read auth.users, and the owner normally has no document_collaborators row.
-- Returns the owner of ONE document, and only when the caller can already
-- access that document (user_can_access_document: owner, direct collaborator,
-- project member or project creator). No access -> zero rows. It never takes
-- a user id, so it cannot be used to look up arbitrary accounts.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_document_owner_profile(doc_id UUID)
RETURNS TABLE (user_id UUID, name TEXT, email TEXT)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL OR NOT public.user_can_access_document(doc_id, 'viewer') THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT u.id,
           NULLIF(COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), '')::TEXT,
           u.email::TEXT
      FROM public.documents d
      JOIN auth.users u ON u.id = d.user_id
     WHERE d.id = doc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_document_owner_profile(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_owner_profile(UUID) TO authenticated;

COMMIT;
