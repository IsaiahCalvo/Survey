-- Universal annotation ID rename: highlight_id → annotation_id.
--
-- `highlight_id` is the universal client-side identifier for EVERY annotation
-- type (survey markers, callouts, ink strokes, region areas, etc.), not just
-- the legacy "Survey Highlight" type that was renamed to Survey Marker. The
-- name is misleading; rename it to match what it actually is.
--
-- Affected tables:
--   * public.document_annotations  — every persisted annotation
--   * public.survey_items          — survey-realtime per-item rows
--
-- PostgreSQL's `RENAME COLUMN` automatically rewrites the column inside
-- existing UNIQUE constraints and the survey_items index, so we only have to
-- rename the index name itself for consistency.

ALTER TABLE public.document_annotations
  RENAME COLUMN highlight_id TO annotation_id;

ALTER TABLE public.survey_items
  RENAME COLUMN highlight_id TO annotation_id;

ALTER INDEX IF EXISTS public.idx_survey_items_highlight
  RENAME TO idx_survey_items_annotation;
