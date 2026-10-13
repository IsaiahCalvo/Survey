/**
 * annotationReconcile.js — bring the screen up to date after a capture
 * (per-field sync, 2026-09-24).
 *
 * After the viewer's capture writes its own changed fields, a mark it edited
 * can differ from what the document now holds (a collaborator changed another
 * field of it that this screen had not painted yet), or it can be gone (a
 * collaborator deleted it; their delete wins). The store returns those as
 * `reconcile` swaps { pageKey, from, to, toPage, key }. This swaps in the
 * document's copy — only where the screen still holds the exact object the
 * capture saw, so a newer local edit is never overwritten.
 *
 * Pure JS — the Node test runner imports this directly.
 */
import { getAnnotationStorageKey } from './annotationStorageIdentity.js';

function markKeyOf(object) {
  return object ? (getAnnotationStorageKey(object) ?? object?.data?.id ?? null) : null;
}

export function applyReconcileSwaps(byPage, swaps) {
  if (!Array.isArray(swaps) || swaps.length === 0) return byPage;
  let next = byPage || {};
  const copied = new Set();
  const pageFor = (pageKey) => {
    const key = String(pageKey);
    if (next === byPage) next = { ...(byPage || {}) };
    if (!copied.has(key)) {
      const page = next[key] || { objects: [] };
      next[key] = { ...page, objects: Array.isArray(page.objects) ? [...page.objects] : [] };
      copied.add(key);
    }
    return next[key];
  };
  const hasKeyAnywhere = (key) => Object.values(next || {}).some((page) => (
    (page?.objects || []).some((object) => String(markKeyOf(object)) === String(key))
  ));
  for (const swap of swaps) {
    if (swap?.from) {
      const current = next?.[String(swap.pageKey)];
      const index = (current?.objects || []).indexOf(swap.from);
      if (index < 0) continue;
      const page = pageFor(swap.pageKey);
      const samePage = swap.to && String(swap.toPage ?? swap.pageKey) === String(swap.pageKey);
      if (samePage) {
        page.objects[index] = swap.to;
        continue;
      }
      page.objects.splice(index, 1);
      if (!swap.to) continue;
    }
    if (swap?.to && !hasKeyAnywhere(swap.key)) {
      pageFor(swap.toPage ?? swap.pageKey).objects.push(swap.to);
    }
  }
  return next;
}

