-- Survey Marker space-vs-module untangle.
--
-- A Survey Marker belongs to a Module (module_id) and optionally a Region
-- (annotation_data.regionId). It must NEVER carry a standalone space_id.
-- Historically the module ID was written into space_id on some creation
-- paths. This backfills the module ID into module_id wherever it is missing,
-- then clears space_id on every survey-marker row.
--
-- The space_id column itself is intentionally left in place: other annotation
-- types (space-scoped region-area annotations) legitimately use it.

UPDATE document_annotations
  SET module_id = space_id
  WHERE annotation_type = 'survey-marker'
    AND module_id IS NULL
    AND space_id IS NOT NULL;

UPDATE document_annotations
  SET space_id = NULL
  WHERE annotation_type = 'survey-marker'
    AND space_id IS NOT NULL;
