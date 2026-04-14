/**
 * Counter numbering — derives the displayed number for each counter
 * annotation from its creation order across the whole document.
 *
 * Counters are stored as Fabric Circle objects with `data: { type: 'counter', createdAt }`.
 * Display number = position in the document-wide creation-order list (1-indexed).
 * Delete → list shortens → remaining counters renumber automatically.
 *
 * Mutates the passed annotationsByPage map in place (each counter's
 * `data.displayNumber` is reassigned). Returns the same reference.
 */
export function renumberCounters(annotationsByPage) {
  if (!annotationsByPage || typeof annotationsByPage !== 'object') {
    return annotationsByPage;
  }

  const counters = [];
  for (const pageKey of Object.keys(annotationsByPage)) {
    const page = annotationsByPage[pageKey];
    if (!page || !Array.isArray(page.objects)) continue;
    for (const obj of page.objects) {
      if (obj && obj.data && obj.data.type === 'counter') {
        counters.push(obj);
      }
    }
  }

  counters.sort((a, b) => {
    const at = (a.data && a.data.createdAt) || 0;
    const bt = (b.data && b.data.createdAt) || 0;
    return at - bt;
  });

  counters.forEach((obj, i) => {
    obj.data = { ...obj.data, displayNumber: i + 1 };
  });

  return annotationsByPage;
}
