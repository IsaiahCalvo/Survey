/**
 * historyStacks.js — orders undo/redo between the local Fabric history and the
 * legacy (Pdfjs) history so the two stacks interleave correctly.
 *
 * Exports getHistoryOrder (reads checkpointId/createdAt/timestamp from an entry's
 * __historyMeta) and shouldUndoLocalBeforeLegacy / shouldRedoLocalBeforeLegacy,
 * which compare ordering keys to pick which stack to pop next. Used by the undo/
 * redo coordinator.
 */
export function getHistoryOrder(entry) {
  const meta = entry?.__historyMeta || entry;
  if (!meta || typeof meta !== 'object') return -1;
  if (Number.isFinite(Number(meta.checkpointId))) return Number(meta.checkpointId);
  const parsed = Date.parse(meta.createdAt || meta.timestamp || '');
  return Number.isFinite(parsed) ? parsed : -1;
}

export function shouldUndoLocalBeforeLegacy(localAction, legacyMeta) {
  if (!localAction) return false;
  if (!legacyMeta) return true;
  return getHistoryOrder(localAction) >= getHistoryOrder(legacyMeta);
}

export function shouldRedoLocalBeforeLegacy(localAction, legacyMeta) {
  if (!localAction) return false;
  if (!legacyMeta) return true;
  return getHistoryOrder(localAction) <= getHistoryOrder(legacyMeta);
}

// ---------------------------------------------------------------------------
// w37 (2026-09-25): one undo timeline across the lanes.
//
// Intended UX (Drawboard / Acrobat / Figma): every gesture is ONE step; Undo
// reverts exactly the newest step of THIS user and Redo re-applies it; any new
// action clears Redo; a press never does nothing while something is left to
// undo. The viewer keeps its steps in two lanes (field-level "local annotation
// history"; the "legacy" lane: eraser transitions, Survey Marker / space
// snapshots) interleaved by one checkpoint counter. These helpers are the
// rules both lanes follow; PDFViewer and tests/undoRedoTimeline.test.mjs share
// them.
// ---------------------------------------------------------------------------

/** How many dead steps one press may skip before it gives up. */
export const HISTORY_SKIP_LIMIT = 200;

/**
 * Run one Undo or Redo press. `attemptOnce()` takes the next step in timeline
 * order and returns:
 *   'applied' — the screen changed: the press is done;
 *   'skipped' — the step can no longer change anything (what it touched was
 *               deleted or changed back by someone else, its erase lanes were
 *               replaced, it is outside this user's scope). attemptOnce has
 *               already taken it off its stack, so the SAME press moves on to
 *               the next step instead of looking dead;
 *   'none'    — nothing left in any lane.
 * Returns the last outcome.
 */
export function runHistoryPress(attemptOnce, limit = HISTORY_SKIP_LIMIT) {
  let outcome = 'none';
  for (let attempt = 0; attempt < limit; attempt += 1) {
    outcome = attemptOnce();
    if (outcome !== 'skipped') return outcome;
  }
  return outcome;
}

/** Page keys (strings) a local history action touches. */
export function historyActionPageKeys(action, out = new Set()) {
  if (!action || typeof action !== 'object') return out;
  if (action.type === 'fabric:document-batch') {
    (action.actions || []).forEach((child) => historyActionPageKeys(child, out));
    return out;
  }
  if (action.pageNumber != null) out.add(String(action.pageNumber));
  return out;
}

/**
 * True when applying `action` turned `before` (annotationsByPage) into an
 * `after` whose touched pages really differ: the user SEES the step.
 * `equal(a, b)` compares two values (jsonEqual in the viewer).
 */
export function historyActionChangedPages(before, after, action, equal) {
  if (before === after) return false;
  const keys = historyActionPageKeys(action);
  if (keys.size === 0) return true;
  for (const key of keys) {
    const left = before?.[key] ?? before?.[Number(key)];
    const right = after?.[key] ?? after?.[Number(key)];
    const leftObjects = Array.isArray(left?.objects) ? left.objects : [];
    const rightObjects = Array.isArray(right?.objects) ? right.objects : [];
    if (!equal(leftObjects, rightObjects)) return true;
  }
  return false;
}

/**
 * A mark whose editor opens by itself on creation (a callout drops you into
 * its text) is ONE gesture from the user's side: draw it, type, click away.
 * Its first commit folds into the create step instead of adding a second one
 * (Drawboard / Acrobat: one Undo removes the whole new callout):
 *   - an update of the just-created mark -> the create step now creates the
 *     mark as committed ('updated');
 *   - a delete of it (left blank / Esc) -> the create step goes, since
 *     nothing is left to undo ('removed');
 * only while that create is still the newest step of all (`latestOrder`).
 * Returns { stack, folded } with folded null when `action` must be pushed as
 * its own step. Never mutates `stack`.
 */
export function foldIntoCreateStep(stack, action, storageKey, latestOrder) {
  const key = storageKey == null ? null : String(storageKey);
  const top = Array.isArray(stack) ? stack[stack.length - 1] : null;
  const keyOf = (entry) => String(entry?.storageKey ?? entry?.annotationId ?? '');
  if (
    !key || !top || !action
    || top.type !== 'fabric:create'
    || keyOf(top) !== key
    || getHistoryOrder(top) !== latestOrder
    || keyOf(action) !== key
  ) return { stack, folded: null };
  if (action.type === 'fabric:update' && action.after) {
    return {
      stack: [...stack.slice(0, -1), { ...top, annotation: action.after }],
      folded: 'updated',
    };
  }
  if (action.type === 'fabric:delete') {
    return { stack: stack.slice(0, -1), folded: 'removed' };
  }
  return { stack, folded: null };
}

// Legacy snapshot steps whose gesture never changes the marks
// (annotationsByPage): Survey Marker create / delete / move and spaces. Their
// snapshots still carry every mark as it was, so restoring the whole snapshot
// would put back, and through the capture SAVE, every mark as it was then: a
// collaborator's stroke drawn since would be deleted, an erase since undone
// would come back. Only the slices the gesture owns are restored.
const LEGACY_REASONS_WITHOUT_MARKS = /^(highlight|survey-marker|space):/;

export function legacyRestoreKeepsCurrentMarks(meta) {
  return LEGACY_REASONS_WITHOUT_MARKS.test(String(meta?.reason || ''));
}

/**
 * The snapshot a legacy Undo / Redo restores: `target`, with the marks (and
 * the callouts derived from them) kept as they are NOW for steps that never
 * change marks. Other legacy steps (a local-only document's annotation saves,
 * callouts) restore their snapshot as before.
 */
export function scopeLegacyRestoreToOwnSlices(meta, currentState, target) {
  if (!target || !legacyRestoreKeepsCurrentMarks(meta)) return target;
  return {
    ...target,
    annotationsByPage: currentState?.annotationsByPage || {},
    callouts: currentState?.callouts || [],
  };
}
