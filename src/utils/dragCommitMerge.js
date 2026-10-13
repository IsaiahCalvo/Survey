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

// Numbers an editor re-derives (page px ↔ page fractions) come back a float
// tail away from where they started. A value within this tolerance of the
// edit-start value is the SAME value, not a change the editor made.
const SAME_NUMBER_EPSILON = 1e-7;

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function snapUnchangedNumbers(original, edited) {
  if (typeof original === 'number' && typeof edited === 'number') {
    const scale = Math.max(1, Math.abs(original));
    return Math.abs(original - edited) <= SAME_NUMBER_EPSILON * scale ? original : edited;
  }
  if (isPlainRecord(original) && isPlainRecord(edited)) {
    let changed = false;
    const out = {};
    for (const key of Object.keys(edited)) {
      const next = Object.prototype.hasOwnProperty.call(original, key)
        ? snapUnchangedNumbers(original[key], edited[key])
        : edited[key];
      if (next !== edited[key]) changed = true;
      out[key] = next;
    }
    return changed ? out : edited;
  }
  return edited;
}

/**
 * What an editor that was opened on an earlier copy of a mark saves when it
 * closes (per-field sync, 2026-09-24). A text box or callout text editor
 * builds its result from the object it captured when editing STARTED; saving
 * that whole object would put back whatever a collaborator changed while the
 * user was typing (the box moved, restyled, resized). Instead only what the
 * editor itself changed (edit-start → edited, ignoring float tails from
 * re-derived geometry) is written onto the mark as it is NOW — the same rule
 * Undo and drag releases follow.
 *
 * @returns the merged object, or null when the mark no longer exists (someone
 *   deleted it while it was being edited — their delete wins).
 */
export function mergeEditOntoCurrent(current, original, edited) {
  if (!current) return null;
  if (!original) return edited;
  const snapped = snapUnchangedNumbers(original, edited);
  return mergeAnnotationUpdateOntoCurrent(current, original, snapped);
}
