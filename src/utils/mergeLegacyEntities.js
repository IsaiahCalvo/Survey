// A late legacy snapshot may add definitions, but current edits win. An id
// that existed when the read began and is now absent was removed by the user.
export function mergeLegacyEntities(current, legacy, initialIds = []) {
  if (!Array.isArray(current) || !Array.isArray(legacy)) return current;
  const initial = new Set(initialIds.map(String));
  const present = new Set(current.map((entity) => String(entity?.id)));
  const additions = [];
  for (const entity of legacy) {
    const id = entity?.id;
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim()) continue;
    const key = String(id);
    if (present.has(key) || initial.has(key)) continue;
    present.add(key);
    additions.push(entity);
  }
  return additions.length ? [...current, ...additions] : current;
}
