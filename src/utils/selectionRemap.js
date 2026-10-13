/**
 * selectionRemap.js — the selection follows the marks, not their list
 * positions (w61, 2026-09-28).
 *
 * A page's selection is kept as positions in its mark list (useSVGInteraction
 * `selectedIds`). When the list changes under it — another screen (or another
 * tab of the same account) deletes, adds or restacks a mark earlier in the
 * list — the same positions point at DIFFERENT marks. Before this, a
 * selection whose positions were still in range was kept as it was, so it
 * silently slid onto the neighbouring mark (its handles jumped) and the next
 * Delete / move / restyle hit a mark the user never picked. Live repro:
 * scripts/verify-two-tab-delete.mjs --selection-shift (B selects the middle of
 * three marks, A deletes the first, B presses Delete: the third one was
 * deleted and the middle one stayed).
 *
 * UX rule now: every selected mark stays selected wherever it moved in the
 * list; a selected mark that is gone drops out of the selection (the others
 * stay selected); nothing that was not selected ever becomes selected. A mark
 * without an id (legacy) keeps its position while that position still exists,
 * as before. Matches Figma / Illustrator: a collaborator's change never moves
 * your selection onto another object.
 *
 * Pure JS — the Node test runner imports this directly.
 */
import { markIdOf } from './moveCommit.js';

/**
 * @param {Set<number>} selected       selected positions in `previousObjects`
 * @param {Array|null} previousObjects the page list the selection was made on
 * @param {Array|null} nextObjects     the page list now
 * @returns {Set<number>} the positions of the same marks in `nextObjects`
 *   (the SAME Set when nothing changed, so callers can bail out).
 */
export function remapSelectedIndices(selected, previousObjects, nextObjects) {
  if (!(selected instanceof Set) || selected.size === 0) return selected;
  const next = Array.isArray(nextObjects) ? nextObjects : [];
  const previous = Array.isArray(previousObjects) ? previousObjects : null;
  // Positions of each id in the new list (an id can appear twice on a page
  // with stacked duplicates: hand them out in order).
  let positionsById = null;
  const takePosition = (id) => {
    if (!positionsById) {
      positionsById = new Map();
      next.forEach((object, index) => {
        const key = markIdOf(object);
        if (key == null) return;
        if (!positionsById.has(key)) positionsById.set(key, []);
        positionsById.get(key).push(index);
      });
    }
    const list = positionsById.get(id);
    return list && list.length ? list.shift() : -1;
  };
  const result = new Set();
  // Marks with an id first (so a kept position never steals one), in the old
  // list order.
  const ordered = [...selected].sort((a, b) => a - b);
  const byPosition = [];
  for (const index of ordered) {
    const before = previous ? previous[index] : undefined;
    const id = markIdOf(before);
    if (id == null) {
      byPosition.push([index, before]);
      continue;
    }
    const at = takePosition(id);
    if (at >= 0) result.add(at);
  }
  for (const [index, before] of byPosition) {
    if (index < 0 || index >= next.length || result.has(index)) continue;
    // No old copy at that position (the selection was set for a list that
    // had not arrived yet, e.g. a paste selecting its new mark): trust it.
    // An id-less legacy mark keeps its position while that position still
    // holds an id-less mark (there is nothing else to follow it by).
    if (before !== undefined && markIdOf(next[index]) != null) continue;
    result.add(index);
  }
  if (result.size === selected.size && [...result].every((index) => selected.has(index))) return selected;
  return result;
}

/**
 * The annotation right-click menu holds list positions too (the mark
 * right-clicked, or the selected group). Its items act when clicked, which
 * can be seconds later, after another screen changed the list. So the menu
 * notes each target's id when it opens (stampMenuTargetIds) and finds the
 * targets again by id when an item runs (resolveMenuTargets): a target that
 * moved is still hit, a target that is gone is skipped, and a neighbour is
 * never hit instead.
 */
export function stampMenuTargetIds(descriptor, objects) {
  if (!descriptor || !Array.isArray(objects)) return descriptor;
  const idAt = (index) => (Number.isInteger(index) && index >= 0 ? markIdOf(objects[index]) : null);
  return {
    ...descriptor,
    annotationTargetId: idAt(descriptor.annotationIndex),
    groupTargetIds: Array.isArray(descriptor.groupIndices)
      ? descriptor.groupIndices.map((index) => idAt(index))
      : null,
  };
}

export function resolveMenuTargets(ctx, objects) {
  if (!ctx || !Array.isArray(objects)) return ctx;
  const hasSingle = ctx.annotationTargetId != null;
  const hasGroup = Array.isArray(ctx.groupTargetIds) && ctx.groupTargetIds.some((id) => id != null);
  if (!hasSingle && !hasGroup) return ctx;
  // Positions of each id now, handed out in order (stacked duplicates share
  // an id: two targets never resolve to the same position).
  let positionsById = null;
  const take = (index, id) => {
    if (id == null) return index; // an id-less legacy mark: its position, as before
    if (!positionsById) {
      positionsById = new Map();
      objects.forEach((object, at) => {
        const key = markIdOf(object);
        if (key == null) return;
        if (!positionsById.has(key)) positionsById.set(key, []);
        positionsById.get(key).push(at);
      });
    }
    const list = positionsById.get(id) || [];
    // Prefer the old position when it still holds this id.
    const same = list.indexOf(index);
    if (same >= 0) return list.splice(same, 1)[0];
    return list.length ? list.shift() : -1;
  };
  const next = { ...ctx };
  if (hasSingle) next.annotationIndex = take(ctx.annotationIndex, ctx.annotationTargetId);
  if (hasGroup && Array.isArray(ctx.groupIndices)) {
    const seen = new Set();
    next.groupIndices = ctx.groupIndices
      .map((index, at) => take(index, ctx.groupTargetIds[at]))
      .filter((index) => {
        if (!Number.isInteger(index) || index < 0 || index >= objects.length || seen.has(index)) return false;
        seen.add(index);
        return true;
      });
  }
  // Every noted target is gone (deleted on another screen while the menu
  // was open): the menu's mark items must not act.
  // (A group that also holds Survey Markers or callouts still has those.)
  next.targetsGone = (hasSingle ? next.annotationIndex < 0 : true)
    && (hasGroup ? next.groupIndices?.length === 0 : true)
    && !(Array.isArray(ctx.groupMarkerIds) && ctx.groupMarkerIds.length > 0)
    && ctx.calloutId == null;
  return next;
}

/** Same targets, same positions (the menu as drawn still matches the list). */
export function sameMenuTargets(a, b) {
  if (!a || !b) return a === b;
  if (a.annotationIndex !== b.annotationIndex) return false;
  const ga = Array.isArray(a.groupIndices) ? a.groupIndices : [];
  const gb = Array.isArray(b.groupIndices) ? b.groupIndices : [];
  return ga.length === gb.length && ga.every((index, at) => index === gb[at]);
}
