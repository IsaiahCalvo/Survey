-- Fix 26 — shared document RLS contract hardening.
--
-- This keeps document/file access tied to public.user_can_access_document().
-- It does not make the documents bucket public and does not grant blanket
-- authenticated access. The changes below address two contract gaps:
--
-- 1. document INSERT should not fail only because an older/test account is
--    missing a user_subscriptions row. Missing subscription still resolves to
--    the free tier through get_*_limit(); storage usage should resolve to 0.
-- 2. document_annotations mutations must be author-scoped for collaborators.
--    Editors/commenters can create and mutate only their own rows. Document
--    owners keep the explicit owner/admin override already present in the
--    product's ownership UI contract.

BEGIN;

DROP POLICY IF EXISTS "Users can upload documents within limits" ON public.documents;
CREATE POLICY "Users can upload documents within limits"
  ON public.documents
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT COUNT(*)
      FROM public.documents
      WHERE user_id = auth.uid()
        AND archived = FALSE
    ) < public.get_document_limit(auth.uid())
    AND (
      COALESCE((
        SELECT storage_used_bytes
        FROM public.user_subscriptions
        WHERE user_id = auth.uid()
      ), 0) + COALESCE(file_size, 0)
    ) <= public.get_storage_limit(auth.uid())
  );

COMMENT ON POLICY "Users can upload documents within limits" ON public.documents IS
  'Fix 26: authenticated owners can insert their own documents within tier limits; missing subscription rows count as 0 storage, not NULL/RLS rejection.';

DROP POLICY IF EXISTS "Users can insert annotations on editable documents" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can update annotations on editable documents" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can delete annotations on editable documents" ON public.document_annotations;

CREATE POLICY "Users can insert own annotations on editable documents"
  ON public.document_annotations
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_can_access_document(document_id, 'editor')
  );

CREATE POLICY "Users can update own annotations or owners can update any"
  ON public.document_annotations
  FOR UPDATE
  USING (
    (
      auth.uid() = user_id
      AND public.user_can_access_document(document_id, 'editor')
    )
    OR public.user_can_access_document(document_id, 'owner')
  )
  WITH CHECK (
    (
      auth.uid() = user_id
      AND public.user_can_access_document(document_id, 'editor')
    )
    OR public.user_can_access_document(document_id, 'owner')
  );

CREATE POLICY "Users can delete own annotations or owners can delete any"
  ON public.document_annotations
  FOR DELETE
  USING (
    (
      auth.uid() = user_id
      AND public.user_can_access_document(document_id, 'editor')
    )
    OR public.user_can_access_document(document_id, 'owner')
  );

COMMENT ON POLICY "Users can insert own annotations on editable documents" ON public.document_annotations IS
  'Fix 26: collaborators can create annotations only as themselves on documents where they have editor access.';
COMMENT ON POLICY "Users can update own annotations or owners can update any" ON public.document_annotations IS
  'Fix 26: collaborator edits are author-scoped; document owners retain the explicit owner override for cross-author edits.';
COMMENT ON POLICY "Users can delete own annotations or owners can delete any" ON public.document_annotations IS
  'Fix 26: collaborator deletes are author-scoped; document owners retain the explicit owner override for cleanup/cross-author deletes.';

COMMIT;
