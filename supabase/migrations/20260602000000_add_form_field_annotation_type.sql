-- Add 'form-field' to the document_annotations.annotation_type CHECK constraint.
--
-- Phase 37 (pdf.js cutover), Stage 4.3 — form-field persistence. Filled form
-- values are stored as ordinary rows in the EXISTING document_annotations table
-- (one row per filled field, payload in the existing annotation_data JSONB),
-- so they ride the same per-user save / sync / reload pipeline as every other
-- annotation. The only schema change required is widening this CHECK so the new
-- type is accepted. No new table, no new column, no RLS change, no index change.
--
-- Apply order (per repo convention):
--   1. Merge the form-field persistence code and build/run the new code.
--   2. Then run this migration: `supabase db push --linked`.
-- Safe to run before the code ships too: it only widens the allowed set, so
-- existing rows and the existing app are unaffected.

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'survey-marker',
    'ink',
    'freetext',
    'square',
    'circle',
    'line',
    'polyline',
    'polygon',
    'stamp',
    'sticky_note',
    'callout',
    'counter',
    'eraser',
    'form-field'
  ));
