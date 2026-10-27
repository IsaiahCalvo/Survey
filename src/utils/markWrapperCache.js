// Dense-sheet drags (perf): every pointermove of a drag sets the layer's
// visualTransform, and SVGAnnotationLayer used to rebuild the wrapper element
// of every mark on the page (hit target, hover glow, inline handlers) and make
// React reconcile all of them, although only the dragged marks change. On a
// 667-mark sheet that was most of the ~9 ms of React work per drag frame.
//
// A mark's wrapper is a pure function of its own inputs (the mark, its drawn
// element, its selected / hovered flags) and of a few layer-wide values. When
// none of them changed, the previous element object is handed back, and React
// skips that mark's whole subtree (same element, same props). Marks that the
// live gesture touches are always built fresh.

/**
 * Whether the wrapper of mark `index` reads the live gesture this render, so
 * it must be built fresh: the mark is moved, resized, rotated, line-edited,
 * previewed or carried (visualTransform), its counter handle is dragged, or it
 * is being edited (the editor's live bounds and edit type feed it).
 */
export function markWrapperIsLive(index, { visualTransform, counterHandlePreview, editingAnnotationIndex } = {}) {
  if (editingAnnotationIndex != null && index === editingAnnotationIndex) return true;
  if (counterHandlePreview && counterHandlePreview.annotationIndex === index) return true;
  const vt = visualTransform;
  if (!vt) return false;
  if (vt.id === index) return true;
  if (vt.id === 'group' && vt.affectedIds?.has?.(index)) return true;
  return !!vt.previewObjects?.[index];
}

const sameValues = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let k = 0; k < a.length; k += 1) if (!Object.is(a[k], b[k])) return false;
  return true;
};

export function createMarkWrapperCache() {
  return { shared: null, byIndex: new Map() };
}

/**
 * Maps `entries` (the layer's staged marks, `{ index, ... }`) to wrapper
 * elements. `shared` lists the layer-wide values every wrapper reads; when one
 * of them changes, nothing is reused. `keyOf(entry)` lists the mark's own
 * inputs, or returns null when the mark is live (built fresh, not kept).
 * Only the current render's wrappers are kept, so the cache never outgrows
 * the page.
 */
export function mapMarkWrappers(cache, shared, entries, keyOf, render) {
  const previous = sameValues(cache.shared, shared) ? cache.byIndex : null;
  const next = new Map();
  const out = entries.map((entry) => {
    const key = keyOf(entry);
    if (!key) return render(entry);
    const hit = previous?.get(entry.index);
    if (hit && sameValues(hit.key, key)) {
      next.set(entry.index, hit);
      return hit.element;
    }
    const element = render(entry);
    next.set(entry.index, { key, element });
    return element;
  });
  cache.shared = shared;
  cache.byIndex = next;
  return out;
}
