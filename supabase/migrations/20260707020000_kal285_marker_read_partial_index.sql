-- KAL-285 (partial) — marker-read partial index.
--
-- Matches the exact query shape of getDocumentAnnotations() in
-- src/services/documentAnnotationService.js:94-100:
--
--   supabase.from('document_annotations')
--     .select('*')
--     .eq('document_id', documentId)
--     .in('annotation_type', SURVEY_MARKER_TYPE_VALUES)   -- ['survey-marker', 'highlight']
--     .order('page_number', { ascending: true })
--     .range(from, from + SUPABASE_PAGE_SIZE - 1);
--
-- SURVEY_MARKER_TYPE_VALUES is defined in packages/shared/src/surveyMarker.ts
-- as ['survey-marker', 'highlight'] (the current + legacy annotation_type
-- values for a Survey Marker row). This loader is the sole read path for the
-- legacy surveyMarker pipeline (see documentAnnotationService.js:69-88).
--
-- A partial index scoped to just these two annotation_type values keeps the
-- index small (excludes ink/shape/text/callout/etc. rows owned by the
-- separate all-types cloud-sync path in annotationCloudSync.js) while
-- covering the document_id filter + page_number sort this query always uses.
--
-- Plain (non-CONCURRENTLY) CREATE INDEX so it runs inside the migration
-- transaction that `supabase db push` uses. IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS idx_document_annotations_marker_read
  ON public.document_annotations (document_id, page_number)
  WHERE annotation_type IN ('survey-marker', 'highlight');

COMMENT ON INDEX public.idx_document_annotations_marker_read IS
  'KAL-285: partial index for getDocumentAnnotations() (documentAnnotationService.js:94-100) — the survey-marker read path filtered by document_id + annotation_type IN (survey-marker, highlight), ordered by page_number.';
