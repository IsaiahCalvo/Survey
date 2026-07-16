/**
 * Resolve a survey marker's Entity from its imported name.
 *
 * Excel carries only the entity name. Re-resolving the coupled id/name/color
 * fields prevents a marker from retaining the previous entity's color.
 */
export function resolveMarkerEntityFromName(marker, entities) {
  if (!marker || typeof marker !== 'object' || !('entityName' in marker)) return marker;
  const name = marker.entityName;
  if (name == null || name === '') {
    if (marker.entityId == null && marker.entityColor == null && marker.entityName == null) return marker;
    return { ...marker, entityId: null, entityName: null, entityColor: null };
  }
  const entity = (entities || []).find((item) => item && item.name === name);
  if (!entity) return marker;
  if (marker.entityId === entity.id && marker.entityColor === entity.color) return marker;
  return { ...marker, entityId: entity.id, entityName: entity.name, entityColor: entity.color };
}
