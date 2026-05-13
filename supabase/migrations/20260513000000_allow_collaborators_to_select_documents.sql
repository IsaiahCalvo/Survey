-- Fix 20 — allow active document collaborators to open shared document rows.
--
-- document_annotations/doc_yjs_* already use user_can_access_document(), but
-- the documents SELECT policy still only allowed auth.uid() = documents.user_id.
-- That left collaborators able to sync annotations by id while the app's
-- document list could not show/open the shared PDF.

DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;

CREATE POLICY "Users can view accessible documents"
  ON public.documents
  FOR SELECT
  USING (public.user_can_access_document(id, 'viewer'));

COMMENT ON POLICY "Users can view accessible documents" ON public.documents IS
  'Fix 20: document owners/creators and active collaborators can SELECT document rows so shared PDFs appear in the app.';
