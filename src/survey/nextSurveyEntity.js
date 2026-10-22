/**
 * The entity the next Survey Marker starts with (owner 2026-10-22: "I should
 * always just have an entity selected"): the first of `preferredIds` that is
 * still in the template (the phone's entity disc, then the one last picked on
 * either platform), else the template's first entity. Null only when the
 * template has no entities.
 */
export function resolveNextSurveyEntity(entities, ...preferredIds) {
  const list = (entities || []).filter((entity) => entity && entity.id != null);
  for (const id of preferredIds) {
    if (id == null) continue;
    const found = list.find((entity) => entity.id === id);
    if (found) return found;
  }
  return list[0] || null;
}
