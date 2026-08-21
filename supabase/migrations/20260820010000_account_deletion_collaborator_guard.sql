-- Block self-serve account deletion when the caller still owns documents
-- that other people can access. Ownership transfer is not implemented here;
-- the owner must remove collaborators (or reassign ownership out of band)
-- before the wipe is allowed. Service-role only — the Edge function is the
-- sole caller.

CREATE OR REPLACE FUNCTION public.account_deletion_owned_document_blockers(
  target_user_id uuid
)
RETURNS TABLE (
  document_id uuid,
  document_name text,
  collaborator_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    COALESCE(NULLIF(d.name, ''), 'Untitled')::text,
    COUNT(dc.id)::integer
  FROM public.documents d
  JOIN public.document_collaborators dc
    ON dc.document_id = d.id
   AND dc.status = 'active'
   AND dc.user_id IS DISTINCT FROM target_user_id
  WHERE d.user_id = target_user_id
  GROUP BY d.id, d.name;
END;
$$;

REVOKE ALL ON FUNCTION public.account_deletion_owned_document_blockers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_deletion_owned_document_blockers(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_account_owned_rows(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.documents d
    JOIN public.document_collaborators dc
      ON dc.document_id = d.id
     AND dc.status = 'active'
     AND dc.user_id IS DISTINCT FROM target_user_id
    WHERE d.user_id = target_user_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_HAS_COLLABORATORS'
      USING ERRCODE = 'P0001',
            HINT = 'Transfer ownership or remove collaborators before deleting the account.';
  END IF;

  DELETE FROM public.documents WHERE user_id = target_user_id;
  DELETE FROM public.projects WHERE user_id = target_user_id;
  DELETE FROM public.templates WHERE user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account_owned_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_account_owned_rows(uuid) TO service_role;
