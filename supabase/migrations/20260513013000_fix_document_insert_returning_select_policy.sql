-- Fix 26 live validation follow-up — allow owner INSERT ... RETURNING.
--
-- App code creates documents with `.insert(...).select().single()`, which maps
-- to INSERT ... RETURNING. The collaborator SELECT policy introduced for shared
-- documents only called user_can_access_document(id, 'viewer'). During RETURNING
-- on a brand-new row, that helper's self-query does not reliably see the row
-- being returned yet, so PostgREST reports an RLS failure even though the INSERT
-- policy itself passes.
--
-- Keep collaborator access on the shared document helper, but add the direct
-- owner fast path back to SELECT. This is not broad authenticated access.

BEGIN;

DROP POLICY IF EXISTS "Users can view accessible documents" ON public.documents;

CREATE POLICY "Users can view accessible documents"
  ON public.documents
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.user_can_access_document(id, 'viewer')
  );

COMMENT ON POLICY "Users can view accessible documents" ON public.documents IS
  'Fix 26 live: owners can SELECT their own document rows directly, including INSERT RETURNING; active collaborators still use user_can_access_document(id, viewer).';

COMMIT;
