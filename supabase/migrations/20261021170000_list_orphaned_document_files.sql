-- Backend security and cost pass: stored PDFs that no row points at.
--
-- The purge paths already unlink the files they orphan, but a file can still be
-- stranded: an upload whose row insert then failed, a client unlink that lost
-- its network, a storage remove that failed after the row was gone. Those bytes
-- stay billed forever. This lists them for archive-purge-sweep, which re-checks
-- each one and removes it through the Storage API (deleting storage.objects
-- rows in SQL would strand the bytes).
--
-- Safety: only files older than p_min_age_hours (an upload lands before its
-- row insert), and only names that no documents.file_path or templates
-- file_path / linked_excel_path points at, archived rows included.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_orphaned_document_files(
  p_limit integer DEFAULT 500,
  p_min_age_hours integer DEFAULT 24
)
RETURNS TABLE(name text, size bigint, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT o.name, (o.metadata->>'size')::bigint, o.created_at
    FROM storage.objects o
   WHERE o.bucket_id = 'documents'
     AND o.created_at < now() - make_interval(hours => GREATEST(COALESCE(p_min_age_hours, 24), 24))
     AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.file_path = o.name)
     AND NOT EXISTS (SELECT 1 FROM public.templates t
                      WHERE t.file_path = o.name OR t.linked_excel_path = o.name)
   ORDER BY o.created_at
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
$$;

COMMENT ON FUNCTION public.list_orphaned_document_files(integer, integer) IS
  'Stored PDFs in the documents bucket older than p_min_age_hours (never under 24) that no document or template row points at. service_role only; archive-purge-sweep removes them through the Storage API.';

REVOKE ALL ON FUNCTION public.list_orphaned_document_files(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_orphaned_document_files(integer, integer) TO service_role;

COMMIT;
