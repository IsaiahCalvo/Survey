/**
 * One undo step for a colour-slider drag that touches ONLY what the drag
 * changed (UX 2026-09-23, smooth sliders).
 *
 * A drag previews many frames with no undo step and records one step on
 * release. That step used to be "the whole page as it was at the first
 * preview frame" -> "the page now". If a collaborator moved or added
 * something on the same page during the drag, their change was inside that
 * diff too, so Undo put their mark back or deleted it. Now the "before" page
 * is the CURRENT page with only the objects the drag itself edited put back to
 * their pre-drag versions, so Undo reverts the drag and nothing else.
 */
import { getAnnotationRenderIdentity } from './annotationStorageIdentity.js';

export const paintObjectKey = (object) => {
  const key = getAnnotationRenderIdentity(object).annotationId;
  return key === '' || key == null ? null : String(key);
};

const objectsOf = (page) => (Array.isArray(page?.objects) ? page.objects : []);

const sameObject = (a, b) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/** Keys of the objects a save changes (edited, added or removed). */
export function collectChangedObjectKeys(previousPage, nextPage) {
  const changed = new Set();
  const before = new Map();
  objectsOf(previousPage).forEach((object) => {
    const key = paintObjectKey(object);
    if (key) before.set(key, object);
  });
  const seen = new Set();
  objectsOf(nextPage).forEach((object) => {
    const key = paintObjectKey(object);
    if (!key) return;
    seen.add(key);
    if (!before.has(key) || !sameObject(before.get(key), object)) changed.add(key);
  });
  before.forEach((_object, key) => { if (!seen.has(key)) changed.add(key); });
  return changed;
}

/**
 * The current page with only `touchedKeys` put back as `baselinePage` had
 * them. An object the drag created is dropped; one it removed comes back.
 */
export function restoreTouchedObjects(currentPage, baselinePage, touchedKeys) {
  if (!currentPage || !touchedKeys || touchedKeys.size === 0) return currentPage;
  const baseline = new Map();
  objectsOf(baselinePage).forEach((object) => {
    const key = paintObjectKey(object);
    if (key) baseline.set(key, object);
  });
  const present = new Set();
  const objects = [];
  objectsOf(currentPage).forEach((object) => {
    const key = paintObjectKey(object);
    if (key) present.add(key);
    if (!key || !touchedKeys.has(key)) { objects.push(object); return; }
    if (baseline.has(key)) objects.push(baseline.get(key));
  });
  touchedKeys.forEach((key) => {
    if (!present.has(key) && baseline.has(key)) objects.push(baseline.get(key));
  });
  return { ...currentPage, objects };
}
