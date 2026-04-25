-- Phase 21 — Cloud sync for all annotation types.
-- Extends document_annotations to hold every tool kind (pen strokes, rectangles,
-- circles, lines, polygons, polylines, free text, stamps, sticky notes, callouts,
-- counter chains, eraser marks) in addition to the existing highlight rows.
--
-- Strategy:
--   1. Add an `annotation_data` JSONB column that holds tool-specific geometry
--      and style (ink path points, polygon vertices, callout knee handle,
--      counter chain id and ordering, etc.). Existing `bounds` column stays as
--      the bounding rectangle for fast page-scoped indexing.
--   2. Relax the `annotation_type` CHECK constraint to accept every supported
--      tool kind. The previous constraint allowed only 'highlight', 'callout',
--      'text', 'shape', 'stamp' — none of which were actually used outside
--      the highlight wire-up.
--   3. Add a GIN index on `annotation_data` for occasional queries (counter
--      chain lookup by series id, callout link lookup, etc.). Most reads will
--      still use the existing per-document and per-page indexes.
--
-- Backwards compatibility:
--   Every existing row has annotation_type='highlight' and matches the relaxed
--   CHECK constraint. The new annotation_data column defaults to '{}' so
--   existing rows pass NOT NULL semantics. Phase 21 callers are the only path
--   that writes non-empty annotation_data.
--
-- Rollback in: 20260425121704_extend_document_annotations_for_all_types_rollback.sql

ALTER TABLE document_annotations
  ADD COLUMN IF NOT EXISTS annotation_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;

ALTER TABLE document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'highlight',
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

CREATE INDEX IF NOT EXISTS idx_document_annotations_data
  ON document_annotations USING GIN (annotation_data);

-- Optional helper index: by-document counter chains (lookup by chain id).
-- Only useful if counter chain queries become a hot path; cheap to maintain
-- because the predicate filters most rows out.
CREATE INDEX IF NOT EXISTS idx_document_annotations_counter_series
  ON document_annotations ((annotation_data->>'seriesId'))
  WHERE annotation_type = 'counter';
