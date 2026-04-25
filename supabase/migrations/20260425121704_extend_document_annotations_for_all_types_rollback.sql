-- Phase 21 rollback — reverts the all-types extension.
-- Apply this only if you need to roll Phase 21 back.
-- WARNING: rolling back loses any rows that were written under the new
-- annotation types (anything other than 'highlight'). Export them first if
-- they matter — they live under annotation_type IN ('ink', 'freetext',
-- 'square', 'circle', 'line', 'polyline', 'polygon', 'stamp', 'sticky_note',
-- 'callout', 'counter', 'eraser').

DROP INDEX IF EXISTS idx_document_annotations_counter_series;
DROP INDEX IF EXISTS idx_document_annotations_data;

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN ('highlight', 'callout', 'text', 'shape', 'stamp'));

ALTER TABLE document_annotations
  DROP COLUMN IF EXISTS annotation_data;
