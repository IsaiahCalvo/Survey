-- Survey Marker rename, step 1 of 2.
-- Widen the annotation_type CHECK constraint so it accepts BOTH the legacy
-- 'highlight' value and the new 'survey-marker' value. Existing rows are not
-- modified here. This lets old and new code coexist during deploy:
--   - old code keeps reading/writing 'highlight'
--   - new code writes 'survey-marker' and reads either
-- Step 2 (migration 20260518000002) backfills rows and removes 'highlight'.

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'highlight',
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
