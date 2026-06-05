/**
 * safeSnapshot.js — guards against cloud-backed state being wiped by an empty incoming snapshot.
 *
 * Exports countSnapshotItems (counts object-map entries, arrays, or 'annotation-pages'
 * objects) and resolveSafeSnapshot, which keeps the current value instead of an empty
 * incoming one when the source is cloudBacked, currently has data, and the emptiness
 * isn't confirmed. Returns {value, preserved, currentCount, incomingCount, context}.
 */
export function countSnapshotItems(value, kind = 'object-map') {
  if (!value) return 0;
  if (kind === 'annotation-pages') {
    return Object.values(value || {}).reduce(
      (sum, page) => sum + (Array.isArray(page?.objects) ? page.objects.length : 0),
      0
    );
  }
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 0;
}

/**
 * Preserve file-derived (PDF-imported) annotations across a cloud hydrate.
 *
 * The cloud only owns user-drawn marks; annotations imported from the PDF file
 * itself (`isPdfImported`) are re-derived from the file and must never be deleted
 * just because the cloud copy lacks them. Without this, a cloud hydrate that
 * returns an empty OR partial annotation set wholesale-replaces page state and the
 * imported marks visibly vanish a moment after they render.
 *
 * Returns `incoming` unchanged (same identity) when there is nothing to preserve,
 * so the no-op common case keeps the caller's identity checks intact.
 *
 * @param {Record<string, {objects?: any[]}>} prev - current page state
 * @param {Record<string, {objects?: any[]}>} incoming - the cloud/hydrated set
 * @returns {Record<string, {objects?: any[]}>}
 */
export function mergePreservingImportedMarks(prev, incoming) {
  if (!prev || typeof prev !== 'object') return incoming;
  const idOf = (o) => o?.id ?? o?.data?.id ?? o?.pdfAnnotationId ?? null;
  let next = null; // lazily clone `incoming` only if we actually preserve something
  for (const [pageKey, prevPage] of Object.entries(prev)) {
    const prevObjects = Array.isArray(prevPage?.objects) ? prevPage.objects : [];
    const importedPrev = prevObjects.filter((o) => o?.isPdfImported);
    if (importedPrev.length === 0) continue;
    const base = next || incoming || {};
    const incomingPage = base[pageKey] || { objects: [] };
    const incomingObjects = Array.isArray(incomingPage.objects) ? incomingPage.objects : [];
    const haveIds = new Set(incomingObjects.map(idOf).filter((v) => v != null));
    const toAdd = importedPrev.filter((o) => {
      const id = idOf(o);
      return id == null || !haveIds.has(id);
    });
    if (toAdd.length === 0) continue;
    if (!next) next = { ...(incoming || {}) };
    next[pageKey] = { ...incomingPage, objects: [...incomingObjects, ...toAdd] };
  }
  return next || incoming;
}

export function resolveSafeSnapshot({
  current,
  incoming,
  kind = 'object-map',
  cloudBacked = false,
  confirmedEmpty = false,
  context = 'snapshot',
} = {}) {
  const currentCount = countSnapshotItems(current, kind);
  const incomingCount = countSnapshotItems(incoming, kind);
  const incomingEmpty = incomingCount === 0;
  const currentHasData = currentCount > 0;
  const preserve = cloudBacked && currentHasData && incomingEmpty && !confirmedEmpty;

  return {
    value: preserve ? current : (incoming ?? (Array.isArray(current) ? [] : {})),
    preserved: preserve,
    currentCount,
    incomingCount,
    context,
  };
}
