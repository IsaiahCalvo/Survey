-- Fix 20 correction — allow active document collaborators to download the PDF
-- bytes for shared documents without making the documents bucket public.
--
-- Existing storage policies only allow object reads when the first path segment
-- matches auth.uid(). That preserves owner paths, but it blocks collaborators
-- because document file paths are stored under the owner's user id, e.g.
-- documents.file_path = '<owner-id>/<project-or-folder>/<file>.pdf'.

DROP POLICY IF EXISTS "Document collaborators can read accessible document files"
  ON storage.objects;

CREATE POLICY "Document collaborators can read accessible document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.user_can_access_document(d.id, 'viewer')
    )
  );
