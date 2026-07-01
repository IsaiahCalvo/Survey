/**
 * surveyMarkerEntityResolver.js — resolve a survey marker's Entity from its name.
 *
 * Extracted VERBATIM from PDFViewer.jsx (module-level pure helper). Pure + idempotent:
 * given a marker carrying only an entityName (e.g. from an Excel materialize overlay),
 * re-resolve the coupled (entityId, entityName, entityColor) triple against the template's
 * entity list so a reloaded/synced marker never shows a stale entity color.
 */

// KAL-309: a survey marker's entity is THREE coupled fields — entityId, entityName, and
// entityColor (the colored dot the panel shows). An Excel row carries only the entity NAME,
// so the materialize overlay sets entityName alone; without re-resolving id+color the marker
// keeps the OLD entity's color (an entity changed GC->X in Excel still shows GC's purple).
// This mirrors the legacy import resolution: find the name in the template's entity list and
// stamp all three. Pure + idempotent, so it is safe to run on every materialize write.
export function resolveMarkerEntityFromName(marker, entities) {
  if (!marker || typeof marker !== 'object' || !('entityName' in marker)) return marker;
  const name = marker.entityName;
  if (name == null || name === '') {
    if (marker.entityId == null && marker.entityColor == null && marker.entityName == null) return marker;
    return { ...marker, entityId: null, entityName: null, entityColor: null };
  }
  const entity = (entities || []).find((e) => e && e.name === name);
  if (!entity) return marker; // unknown name (rare — the Excel entity column is a constrained dropdown)
  if (marker.entityId === entity.id && marker.entityColor === entity.color) return marker;
  return { ...marker, entityId: entity.id, entityName: entity.name, entityColor: entity.color };
}
