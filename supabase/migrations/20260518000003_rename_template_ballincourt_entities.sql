-- Finish the "Ball in Court" -> "Entity" rename for survey templates.
--
-- The earlier rename (migration 20260518000000) converted the ball_in_court_*
-- columns on document_annotations and survey_items, and the application code
-- was updated to use `entities`. But each template's content is stored as a
-- JSON blob in templates.config, and that blob still carries the entity roster
-- under the legacy key `ballInCourtEntities`. The survey screen reads
-- `entities`, finds nothing, and skips the Entity step.
--
-- This rewrites every template's config: it copies the legacy roster to
-- `entities` (only when `entities` is not already present) and drops the old
-- key. Guarded by a WHERE clause so only affected rows are touched.

UPDATE templates
SET config = (config::jsonb - 'ballInCourtEntities')
  || jsonb_build_object(
       'entities',
       COALESCE(config::jsonb -> 'entities', config::jsonb -> 'ballInCourtEntities')
     )
WHERE config::jsonb ? 'ballInCourtEntities';
