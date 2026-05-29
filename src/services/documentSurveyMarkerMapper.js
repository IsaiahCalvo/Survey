/**
 * documentSurveyMarkerMapper.js — survey-marker <-> Supabase row mappers.
 *
 * Exports buildSurveyMarkerRow (local annotation -> DB row) and
 * mapSurveyMarkerRowToLocalAnnotation (DB row -> local annotation). Resolves
 * Module/Region visibility scope, keeps stored color in step with entityColor,
 * and enforces that survey markers carry no standalone space_id.
 * Part of the separate survey-marker pipeline — see docs/ANNOTATION-CONTRACT.md.
 */
import { ANNOTATION_VISIBILITY_SCOPE, getAnnotationVisibilityScope } from '../utils/annotationVisibilityRules.js';
import { SURVEY_MARKER_TYPE } from '../utils/surveyMarkerType.js';

const getSurveyMarkerScope = (annotation) => getAnnotationVisibilityScope({
  moduleId: annotation?.moduleId ?? null,
  regionId: annotation?.regionId ?? null,
});

export function buildSurveyMarkerRow({
  documentId,
  userId,
  annotationId,
  annotation = {},
}) {
  const regionId = annotation.regionId ?? null;
  const scope = getSurveyMarkerScope(annotation);

  return {
    document_id: documentId,
    user_id: userId,
    annotation_id: annotationId,
    annotation_type: SURVEY_MARKER_TYPE,
    page_number: annotation.pageNumber || 1,
    bounds: annotation.bounds || {},
    category_id: annotation.categoryId || null,
    module_id: annotation.moduleId || null,
    // Survey Markers belong to a Module + optional Region only. They never
    // carry a standalone space_id; that column stays null for this type.
    space_id: null,
    name: annotation.name || null,
    notes: annotation.notes || annotation.note || null,
    entity_id: annotation.entityId || null,
    entity_name: annotation.entityName || null,
    checklist_responses: annotation.checklistResponses || {},
    changed_by: annotation.changedBy || null,
    changed_date: annotation.changedDate || null,
    // Persist the entity's colour as the marker colour. Editing a marker's
    // Entity updates `entityColor` but historically not `color`; saving
    // `entityColor` here keeps the stored colour in step with the Entity so
    // the marker no longer reloads with a stale fallback fill.
    color: annotation.entityColor || annotation.color || '#FFFF00',
    opacity: annotation.opacity || 0.3,
    last_modified_by: userId,
    version: (annotation.version || 0) + 1,
    annotation_data: {
      ...(annotation.annotationData || {}),
      regionId,
      scope,
    },
  };
}

export function mapSurveyMarkerRowToLocalAnnotation(row) {
  if (!row) return null;
  const annotationData = row.annotation_data && typeof row.annotation_data === 'object'
    ? row.annotation_data
    : {};
  const regionId = annotationData.regionId ?? null;

  return {
    annotationId: row.annotation_id,
    pageNumber: row.page_number,
    bounds: row.bounds,
    categoryId: row.category_id,
    moduleId: row.module_id,
    regionId,
    name: row.name,
    notes: row.notes,
    note: row.notes,
    entityId: row.entity_id,
    entityName: row.entity_name,
    checklistResponses: row.checklist_responses || {},
    changedBy: row.changed_by,
    changedDate: row.changed_date,
    color: row.color,
    // Mirror the stored colour back onto entityColor so a reloaded marker that
    // has an Entity renders with the same fill it had before the reload.
    entityColor: row.entity_id ? row.color : undefined,
    opacity: row.opacity,
    version: row.version,
    supabaseId: row.id,
    lastSyncedAt: row.updated_at,
    userId: row.user_id,
    lastModifiedBy: row.last_modified_by,
    annotationData,
    visibilityScope: annotationData.scope || (
      regionId
        ? ANNOTATION_VISIBILITY_SCOPE.SURVEY_REGION
        : ANNOTATION_VISIBILITY_SCOPE.SURVEY
    ),
  };
}
