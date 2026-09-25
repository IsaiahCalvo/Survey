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

// Erase Undo/Redo failures that say nothing about the step itself: the store
// is not open yet (it closes while its tab is hidden and reopens when shown)
// or an authoritative rollback is resetting history. The step is kept and the
// press stops; only a real conflict drops a step.
const TRANSIENT_ERASE_HISTORY_REASONS = new Set(['sync-not-ready', 'stale-handle', 'authoritative-rollback']);

export function isTransientEraseHistoryFailure(result) {
  if (!result || result.status === 'applied' || result.status === 'noop') return false;
  return TRANSIENT_ERASE_HISTORY_REASONS.has(String(result.reason || ''));
}

/**
 * Whether an applied erase Undo/Redo changed what the page shows. 'noop' (an
 * empty transition) or lanes on marks nobody sees any more (someone deleted
 * them) change nothing visible: the press moves on to the next step.
 * `before` is the screen's annotationsByPage, `result.byPage` the one after;
 * `meta.context.pageNumber` names the erased page.
 */
export function eraseTransitionChangedScreen(result, before, meta, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  if (!result || result.status === 'noop') return false;
  const after = result.byPage;
  if (!after || typeof after !== 'object') return true;
  const pageNumber = meta?.context?.pageNumber;
  const keys = pageNumber != null
    ? [String(pageNumber)]
    : [...new Set([...Object.keys(before || {}), ...Object.keys(after)])];
  return keys.some((key) => {
    const left = before?.[key]?.objects || before?.[Number(key)]?.objects || [];
    const right = after?.[key]?.objects || after?.[Number(key)]?.objects || [];
    return !equal(left, right);
  });
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

// Legacy snapshot steps (Survey Marker create / delete / move, spaces) keep a
// snapshot of EVERYTHING taken before the gesture. Restoring it whole put back
// every mark, Survey Marker and space as they were then, and the capture SAVED
// that: a collaborator's newer stroke or Survey Marker was deleted, an Excel
// sync reverted. Undo / Redo now restore only what the gesture owns:
//   * Survey Marker steps: that marker (context.annotationId). Marks untouched.
//   * space steps: that space (context.spaceId), plus the marks and Survey
//     Markers its cascade removed (a space delete / region replace deletes
//     what lies in the space): Undo puts back the ones in the space that are
//     missing now; Redo of a delete / update removes the ones in the space the
//     redo snapshot does not have. Marks outside the space are untouched.
const SURVEY_MARKER_REASON = /^(highlight|survey-marker):/;
const SPACE_REASON = /^space:/;
const SPACE_CASCADE_REASON = /^space:(delete|update)$/;

export function legacyRestoreKeepsCurrentMarks(meta) {
  const reason = String(meta?.reason || '');
  return SURVEY_MARKER_REASON.test(reason) || SPACE_REASON.test(reason);
}

const hasOwnKey = (record, key) => Object.prototype.hasOwnProperty.call(record || {}, key);
const markId = (object) => String(object?.data?.id ?? object?.id ?? object?.annotationId ?? '');

function spaceScope(spaceId, ...spaceLists) {
  const regionIds = new Set();
  for (const list of spaceLists) {
    for (const space of Array.isArray(list) ? list : []) {
      if (space?.id !== spaceId) continue;
      for (const page of space.assignedPages || []) {
        for (const region of page?.regions || []) if (region?.regionId) regionIds.add(region.regionId);
      }
    }
  }
  return (entry) => Boolean(entry) && (
    Boolean(entry.regionId && regionIds.has(entry.regionId))
    || entry.spaceId === spaceId
    || entry.moduleId === spaceId
  );
}

function mergeSpaces(current, target, spaceId) {
  const currentList = Array.isArray(current) ? current : [];
  const targetList = Array.isArray(target) ? target : [];
  const out = currentList.filter((space) => space?.id !== spaceId);
  const index = targetList.findIndex((space) => space?.id === spaceId);
  if (index < 0) return out;
  const currentIndex = currentList.findIndex((space) => space?.id === spaceId);
  out.splice(currentIndex >= 0 ? currentIndex : Math.min(index, out.length), 0, targetList[index]);
  return out;
}

function mergeScopedMarks(currentByPage, targetByPage, inScope, direction) {
  const current = currentByPage || {};
  const target = targetByPage || {};
  const ids = (byPage) => new Set(Object.values(byPage).flatMap((page) => (page?.objects || []).map(markId)));
  let next = current;
  if (direction === 'undo') {
    const present = ids(current);
    for (const [pageKey, page] of Object.entries(target)) {
      (page?.objects || []).forEach((object, index) => {
        const id = markId(object);
        if (!id || present.has(id) || !inScope({ ...object, pageNumber: Number(pageKey) })) return;
        const currentPage = next[pageKey] || { ...page, objects: [] };
        const objects = [...(currentPage.objects || [])];
        objects.splice(Math.min(index, objects.length), 0, object);
        next = { ...next, [pageKey]: { ...currentPage, objects } };
        present.add(id);
      });
    }
    return next;
  }
  const kept = ids(target);
  for (const [pageKey, page] of Object.entries(current)) {
    const objects = page?.objects || [];
    const filtered = objects.filter((object) => (
      kept.has(markId(object)) || !inScope({ ...object, pageNumber: Number(pageKey) })
    ));
    if (filtered.length !== objects.length) next = { ...next, [pageKey]: { ...page, objects: filtered } };
  }
  return next;
}

function mergeScopedSurveyMarkers(current, target, inScope, direction) {
  const next = { ...(current || {}) };
  if (direction === 'undo') {
    for (const [id, marker] of Object.entries(target || {})) {
      if (!hasOwnKey(next, id) && inScope(marker)) next[id] = marker;
    }
    return next;
  }
  for (const [id, marker] of Object.entries(current || {})) {
    if (!hasOwnKey(target, id) && inScope(marker)) delete next[id];
  }
  return next;
}

/**
 * The state a legacy Undo / Redo restores (see above). `direction` is 'undo'
 * (target = the snapshot from before the gesture) or 'redo' (target = the
 * state from just before the Undo). `deriveCallouts(byPage)` rebuilds the
 * callout list from the merged marks. Other legacy steps (a local-only
 * document's annotation saves, callouts) restore their snapshot as before, and
 * so does a space step that recorded no space id.
 */
export function scopeLegacyRestoreToOwnSlices(meta, currentState, target, { direction = 'undo', deriveCallouts = null } = {}) {
  if (!target || !legacyRestoreKeepsCurrentMarks(meta)) return target;
  const reason = String(meta?.reason || '');
  const context = meta?.context || {};
  const current = currentState || {};
  const out = {
    ...target,
    annotationsByPage: current.annotationsByPage || {},
    callouts: current.callouts || [],
    surveyMarkers: current.surveyMarkers || {},
    spaces: current.spaces || [],
  };
  if (SURVEY_MARKER_REASON.test(reason)) {
    const id = context.annotationId != null ? String(context.annotationId) : null;
    const targetMarkers = target.surveyMarkers || {};
    if (id) {
      const next = { ...out.surveyMarkers };
      if (hasOwnKey(targetMarkers, id)) next[id] = targetMarkers[id];
      else delete next[id];
      out.surveyMarkers = next;
    } else if (direction === 'undo') {
      // No id recorded: bring back what is missing, remove nothing.
      const next = { ...out.surveyMarkers };
      for (const [key, marker] of Object.entries(targetMarkers)) if (!hasOwnKey(next, key)) next[key] = marker;
      out.surveyMarkers = next;
    } else {
      out.surveyMarkers = targetMarkers;
    }
    return out;
  }
  const spaceId = context.spaceId != null ? String(context.spaceId) : null;
  if (!spaceId) return target;
  out.spaces = mergeSpaces(current.spaces, target.spaces, spaceId);
  const inScope = spaceScope(spaceId, current.spaces, target.spaces);
  if (direction === 'undo' || SPACE_CASCADE_REASON.test(reason)) {
    out.annotationsByPage = mergeScopedMarks(current.annotationsByPage, target.annotationsByPage, inScope, direction);
    out.surveyMarkers = mergeScopedSurveyMarkers(current.surveyMarkers, target.surveyMarkers, inScope, direction);
    if (out.annotationsByPage !== current.annotationsByPage && typeof deriveCallouts === 'function') {
      out.callouts = deriveCallouts(out.annotationsByPage);
    }
  }
  return out;
}

/** True when a scoped legacy restore changes anything the user can see. */
export function legacyRestoreChangesState(currentState, restoredState, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {
  if (!restoredState) return false;
  for (const key of ['annotationsByPage', 'surveyMarkers', 'spaces', 'pendingSurveyMarkerUi']) {
    if (!hasOwnKey(restoredState, key)) continue;
    if (!equal(currentState?.[key] ?? null, restoredState[key] ?? null)) return true;
  }
  return false;
}
