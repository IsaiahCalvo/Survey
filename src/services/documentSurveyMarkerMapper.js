import { ANNOTATION_VISIBILITY_SCOPE, getAnnotationVisibilityScope } from '../utils/annotationVisibilityRules.js';
import { SURVEY_MARKER_TYPE } from '../utils/surveyMarkerType.js';

const getSurveyMarkerScope = (annotation) => getAnnotationVisibilityScope({
  moduleId: annotation?.moduleId ?? null,
  regionId: annotation?.regionId ?? null,
});

export function buildSurveyMarkerRow({
  documentId,
  userId,
  highlightId,
  annotation = {},
}) {
  const regionId = annotation.regionId ?? null;
  const scope = getSurveyMarkerScope(annotation);

  return {
    document_id: documentId,
    user_id: userId,
    highlight_id: highlightId,
    annotation_type: SURVEY_MARKER_TYPE,
    page_number: annotation.pageNumber || 1,
    bounds: annotation.bounds || {},
    category_id: annotation.categoryId || null,
    module_id: annotation.moduleId || null,
    space_id: annotation.spaceId || null,
    name: annotation.name || null,
    notes: annotation.notes || annotation.note || null,
    entity_id: annotation.entityId || null,
    entity_name: annotation.entityName || null,
    checklist_responses: annotation.checklistResponses || {},
    changed_by: annotation.changedBy || null,
    changed_date: annotation.changedDate || null,
    color: annotation.color || '#FFFF00',
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
    highlightId: row.highlight_id,
    pageNumber: row.page_number,
    bounds: row.bounds,
    categoryId: row.category_id,
    moduleId: row.module_id,
    spaceId: row.space_id,
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
