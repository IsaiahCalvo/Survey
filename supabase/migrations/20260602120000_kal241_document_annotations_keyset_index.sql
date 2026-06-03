-- KAL-241 — durable annotation read timeout fix (keyset pagination support).
--
-- The hydrate read (annotationCloudSync.loadPagedAnnotationRows) now seeks by
-- primary key:  WHERE document_id = $1 [AND id > $cursor] ORDER BY id LIMIT $n.
-- That access pattern wants a composite btree keyed on (document_id, id) so
-- Postgres can jump straight to the cursor position for a single document and
-- scan forward, reading only the rows in the current page (no OFFSET re-scan,
-- no server-side sort). The existing (document_id) and (document_id, page_number)
-- indexes do NOT order by id within a document, so without this index the seek
-- degrades to fetching every row for the document and sorting per statement.
--
-- Plain (non-CONCURRENTLY) CREATE INDEX so it runs inside the migration
-- transaction that `supabase db push` uses. IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS idx_document_annotations_doc_id_keyset
  ON public.document_annotations (document_id, id);

COMMENT ON INDEX public.idx_document_annotations_doc_id_keyset IS
  'KAL-241: supports keyset (seek) pagination of the durable annotation hydrate read by (document_id, id), replacing the OFFSET reader that timed out on large documents.';
