// Move a category definition and its marks together. IDs, responses, notes,
// media and page positions stay intact; another module's marks are untouched.
export function moveSurveyCategories(template, markers, sourceId, destinationId, categoryIds) {
  const modules = template?.modules || template?.spaces || [];
  const source = modules.find((entry) => entry.id === sourceId);
  const destination = modules.find((entry) => entry.id === destinationId);
  const ids = new Set(categoryIds || []);
  if (!source || !destination || sourceId === destinationId || !ids.size) return { ok: false, reason: 'Choose another module.' };
  const categories = (source.categories || []).filter((entry) => ids.has(entry.id));
  if (categories.length !== ids.size) return { ok: false, reason: 'A selected category is no longer here.' };
  if (categories.some((entry) => (destination.categories || []).some((other) => other.id === entry.id || String(other.name || '').trim().toLowerCase() === String(entry.name || '').trim().toLowerCase()))) {
    return { ok: false, reason: 'The destination already has a category with this name.' };
  }
  const nextModules = modules.map((entry) => entry.id === sourceId
    ? { ...entry, categories: (entry.categories || []).filter((category) => !ids.has(category.id)) }
    : entry.id === destinationId ? { ...entry, categories: [...(entry.categories || []), ...categories] } : entry);
  const nextMarkers = Object.fromEntries(Object.entries(markers || {}).map(([id, marker]) => [id,
    marker?.moduleId === sourceId && ids.has(marker.categoryId)
      ? { ...marker, moduleId: destinationId, ...(marker.spaceId === sourceId ? { spaceId: destinationId } : {}) }
      : marker,
  ]));
  return { ok: true, template: { ...template, modules: nextModules, spaces: nextModules }, markers: nextMarkers, categories };
}
