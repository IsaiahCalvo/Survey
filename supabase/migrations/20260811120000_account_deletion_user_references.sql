-- Allow a user to delete their Survey account without historical invite or
-- collaborator audit rows blocking auth.users deletion. Ownership/membership
-- rows still CASCADE; attribution-only columns become NULL.

ALTER TABLE public.document_invites
  DROP CONSTRAINT IF EXISTS document_invites_accepted_by_fkey,
  ADD CONSTRAINT document_invites_accepted_by_fkey
    FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.project_invites
  DROP CONSTRAINT IF EXISTS project_invites_accepted_by_fkey,
  ADD CONSTRAINT project_invites_accepted_by_fkey
    FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.template_invites
  DROP CONSTRAINT IF EXISTS template_invites_accepted_by_fkey,
  ADD CONSTRAINT template_invites_accepted_by_fkey
    FOREIGN KEY (accepted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_last_modified_by_fkey,
  ADD CONSTRAINT document_annotations_last_modified_by_fkey
    FOREIGN KEY (last_modified_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.document_collaborators
  DROP CONSTRAINT IF EXISTS document_collaborators_invited_by_fkey,
  ADD CONSTRAINT document_collaborators_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.project_collaborators
  DROP CONSTRAINT IF EXISTS project_collaborators_invited_by_fkey,
  ADD CONSTRAINT project_collaborators_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.template_collaborators
  DROP CONSTRAINT IF EXISTS template_collaborators_invited_by_fkey,
  ADD CONSTRAINT template_collaborators_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- The original KAL-307 declaration combined NOT NULL with ON DELETE SET NULL.
-- Make the audit actor nullable so deletion of a collaborator account cannot
-- be blocked by a workbook registered on somebody else's document.
ALTER TABLE public.excel_workbook_registrations
  ALTER COLUMN registered_by DROP NOT NULL;

-- Service-role-only transaction for the core owned rows. The Edge function
-- runs this before deleting storage, so an interrupted request cannot leave
-- live document rows that reference already-deleted PDF objects.
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

  DELETE FROM public.documents WHERE user_id = target_user_id;
  DELETE FROM public.projects WHERE user_id = target_user_id;
  DELETE FROM public.templates WHERE user_id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_account_owned_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_account_owned_rows(uuid) TO service_role;
