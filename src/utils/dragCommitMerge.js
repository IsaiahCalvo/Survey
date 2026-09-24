/**
 * dragCommitMerge.js — what a drag saves when it ends (per-field sync,
 * 2026-09-24).
 *
 * Some drags (a polygon / polyline corner, a counter's Shift-orbit, a group
 * rotate / resize) keep a copy of the whole page while the pointer moves and
 * used to save that copy on release. Anything a collaborator changed after the
 * copy was taken — another mark's colour, a mark they added or deleted, a
 * field of the dragged mark itself — was then written back over their change.
 *
 * Instead the release saves the page AS IT IS NOW with only each dragged
 * mark's own change (its drag-start object → its last drag frame) written onto
 * it, field by field, exactly like Undo applies an update
 * (mergeAnnotationUpdateOntoCurrent). Marks are matched by id, so a mark that
 * moved in the list meanwhile is still found; a mark someone deleted during
 * the drag stays deleted.
 *
 * Pure JS — the Node test runner imports this directly.
 */
import { mergeAnnotationUpdateOntoCurrent } from './annotationLocalHistory.js';

const markId = (object) => {
  const id = object?.data?.id ?? object?.id ?? null;
  return id == null || id === '' ? null : String(id);
};

function findMark(objects, startObject, fallbackIndex) {
  const id = markId(startObject);
  if (id != null) return objects.findIndex((object) => markId(object) === id);
  return objects[fallbackIndex] ? fallbackIndex : -1;
}

/**
 * @param {object} currentPage   the page's annotations now ({ objects })
 * @param {object} draggedPage   the drag's last page copy ({ objects })
 * @param {object} startObjects  { [dragStartIndex]: drag-start object }
 * @returns {{ annotations: object, indexes: number[] } | null} null when no
 *   dragged mark is left to save.
 */
export function mergeDraggedMarksOntoPage(currentPage, draggedPage, startObjects) {
  const objects = Array.isArray(currentPage?.objects) ? currentPage.objects : [];
  const draggedObjects = Array.isArray(draggedPage?.objects) ? draggedPage.objects : [];
  let nextObjects = null;
  const indexes = [];
  for (const [indexKey, startObject] of Object.entries(startObjects || {})) {
    if (!startObject) continue;
    const startIndex = Number(indexKey);
    const draggedIndex = findMark(draggedObjects, startObject, startIndex);
    const dragged = draggedIndex >= 0 ? draggedObjects[draggedIndex] : null;
    if (!dragged) continue;
    const index = findMark(objects, startObject, startIndex);
    if (index < 0) continue; // deleted by someone else during the drag
    const merged = mergeAnnotationUpdateOntoCurrent(objects[index], startObject, dragged);
    if (merged === objects[index]) continue;
    if (!nextObjects) nextObjects = [...objects];
    nextObjects[index] = merged;
    indexes.push(index);
  }
  if (!nextObjects) return null;
  return { annotations: { ...(currentPage || {}), objects: nextObjects }, indexes };
}
