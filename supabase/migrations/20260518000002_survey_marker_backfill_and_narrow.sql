-- Survey Marker rename, step 2 of 2.
--
-- DO NOT APPLY until the renamed application code is built and running.
-- The pre-rename app filters survey markers by annotation_type='highlight';
-- if this migration runs while that old build is still in use, every survey
-- marker disappears from that build. The renamed code reads BOTH values, so
-- it is safe once that code is live.
--
-- Apply order:
--   1. Merge the `survey-marker-rename` branch and build/run the new code.
--   2. Then run this migration: `supabase db push --linked`.
--
-- This backfills every legacy row to the new value, then narrows the
-- annotation_type CHECK constraint to drop the old 'highlight' value.

UPDATE document_annotations
  SET annotation_type = 'survey-marker'
  WHERE annotation_type = 'highlight';

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
    'eraser'
  ));
