/**
 * disabledActions.js — when an action button may act, and what its tooltip
 * says when it may not (owner 2026-10-06).
 *
 *   "When I'm in select mode, if nothing is selected, I shouldn't be able to
 *    copy, move, duplicate, share, or even delete anything ... If nothing is
 *    selected, they shouldn't be able to interact until they select something.
 *    That goes for all types of buttons."
 *
 * Pure rules only (no React), so node tests pin them. The LOOK of a disabled
 * control lives in one place: src/styles/states.css section 6 (--disabled-ink).
 *
 * A disabled control's tooltip never names the action as if it would happen
 * ("Delete"); it says what is missing ("Select something to delete").
 */

const VERBS = Object.freeze({
  duplicate: 'duplicate',
  move: 'move',
  copy: 'copy',
  share: 'share',
  delete: 'delete',
});

/**
 * One select-mode action ([Duplicate] [Move] [Copy] [Share] [Delete]).
 *
 * count  how many items are picked.
 * can    the caller's per-action override: true (default) = the selection
 *        supports it; false = it does not; a string = it does not, and the
 *        string is the reason shown as the tooltip ("Share one project at a
 *        time", "Moving categories is not available yet").
 *
 * Enabled only when at least one item is picked AND the selection supports it.
 */
export function selectModeActionState(key, label, { count = 0, can } = {}) {
  const verb = VERBS[key] || String(label || key).toLowerCase();
  if (!(count > 0)) return { enabled: false, tooltip: `Select something to ${verb}` };
  if (can === false) return { enabled: false, tooltip: `Can't ${verb} this selection` };
  if (typeof can === 'string' && can) return { enabled: false, tooltip: can };
  return { enabled: true, tooltip: label };
}

/**
 * "All" / "None" in a select-mode row. It is how you select, so it stays
 * enabled whenever there is anything to pick; only an empty list turns it off.
 * `total` undefined means the caller did not say, which keeps it enabled.
 */
export function selectAllState({ total, allSelected = false } = {}) {
  if (total === 0) return { enabled: false, tooltip: 'Nothing to select' };
  return { enabled: true, tooltip: allSelected ? 'Select none' : 'Select all' };
}

/**
 * Generic rule for any button whose action needs something: enabled when the
 * thing is there; the tooltip is the label when enabled and the reason when not.
 */
export function needsState(has, label, reason) {
  return has ? { enabled: true, tooltip: label } : { enabled: false, tooltip: reason || label };
}

/**
 * The four z-order items of a ONE-mark right-click menu (shape or callout).
 *
 * index / length  the mark's slot in its page's stack (0 = bottom).
 * hasMarkers      the page also shows Survey Markers, which share the stack
 *                 through a different planner: then every item stays enabled
 *                 (this rule cannot see where the mark sits among them).
 * overlapAbove / overlapBelow  whether any mark above / below overlaps it.
 *                 "Bring forward" / "Send backward" step past the next
 *                 OVERLAPPING mark (Figma rule, PDFViewer
 *                 handleReorderAnnotation), so with none they do nothing.
 *                 undefined = unknown (geometry not drawn), which keeps them on.
 *
 * Returns { front, forward, backward, back } - true = enabled.
 */
export function zOrderMenuState({ index, length, hasMarkers = false, overlapAbove, overlapBelow } = {}) {
  if (hasMarkers || !Number.isInteger(index) || !(length > 0) || index < 0 || index >= length) {
    return { front: true, forward: true, backward: true, back: true };
  }
  const top = index >= length - 1;
  const bottom = index <= 0;
  return {
    front: !top,
    forward: !top && overlapAbove !== false,
    backward: !bottom && overlapBelow !== false,
    back: !bottom,
  };
}

/**
 * The page menu's Reset: true only when the page carries a mirror, or a turn
 * away from the rotation it was opened with (PagesPanel's pageTransformations
 * entry: { rotation, baseRotation, mirrorH, mirrorV }).
 */
export function pageHasTransform(t) {
  if (!t) return false;
  if (t.mirrorH || t.mirrorV) return true;
  const base = Number.isFinite(t.baseRotation) ? t.baseRotation : 0;
  const rotation = Number.isFinite(t.rotation) ? t.rotation : base;
  return ((rotation - base) % 360 + 360) % 360 !== 0;
}
