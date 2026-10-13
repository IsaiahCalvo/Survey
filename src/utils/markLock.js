/**
 * markLock.js — the user lock on a mark (owner ruling 2026-09-28).
 *
 * RULED 2026-09-28 owner: open editing + lock.
 *   - Anyone who can edit may cut, move, restyle or delete ANY mark with no
 *     pop-up (safety = Undo + History + Lock).
 *   - Any mark can be locked / unlocked from the right-click menu (one mark or
 *     a whole selection). Only the mark's author or the document owner may
 *     lock or unlock it (permissionScope.canToggleLock).
 *   - A locked mark cannot be moved, resized, restyled, cut, deleted or erased
 *     by ANYONE — its author and the owner unlock it first. It is still
 *     selectable and visible, and shows a small lock when selected.
 *
 * Where the stamp lives (permissionScope.getMarkLockedBy reads all of them):
 *   - ordinary marks: `data.lockedBy` (a per-field write in the mark store, so
 *     it syncs like any other field);
 *   - callouts: `lockedBy` on the callout record; the projected group carries
 *     it as `data.lockedBy` and inside `data.legacyCallout`;
 *   - Survey Markers: `lockedBy` on the marker record.
 *
 * This module is pure (no React): the lock stamp helpers and the SAVE GUARD
 * the viewer runs on every page save, so a path that forgot to check the lock
 * still cannot change a locked mark.
 */
import { canToggleLock, getMarkLockedBy } from '../lib/collab/permissionScope.js';

/** The stable id of a page object (data.id, else top-level id). */
export function lockMarkIdOf(object) {
  if (!object || typeof object !== 'object') return null;
  const id = object?.data?.id ?? object?.id ?? null;
  return id == null ? null : String(id);
}

/**
 * A copy of a page object with its lock set to `lockedBy` (a user id) or
 * removed (null). Callout groups also update the reload payload in
 * data.legacyCallout, so a reload keeps the lock.
 */
export function withMarkLock(object, lockedBy) {
  if (!object || typeof object !== 'object') return object;
  const next = { ...object, data: { ...(object.data || {}) } };
  if (lockedBy) next.data.lockedBy = String(lockedBy);
  else delete next.data.lockedBy;
  if (next.data.legacyCallout && typeof next.data.legacyCallout === 'object') {
    next.data.legacyCallout = { ...next.data.legacyCallout };
    if (lockedBy) next.data.legacyCallout.lockedBy = String(lockedBy);
    else delete next.data.legacyCallout.lockedBy;
  }
  // A stray top-level stamp would keep the mark locked after an unlock.
  if (!lockedBy) delete next.lockedBy;
  return next;
}

/** A copy of a callout record with its lock set / removed. */
export function withCalloutLock(callout, lockedBy) {
  if (!callout || typeof callout !== 'object') return callout;
  const next = { ...callout };
  if (lockedBy) next.lockedBy = String(lockedBy);
  else delete next.lockedBy;
  return next;
}

/** A copy of a Survey Marker record with its lock set / removed. */
export function withSurveyMarkerLock(record, lockedBy) {
  if (!record || typeof record !== 'object') return record;
  const next = { ...record };
  if (lockedBy) next.lockedBy = String(lockedBy);
  else delete next.lockedBy;
  // A stale copy from a row projection must never outlive an Unlock.
  if (next.annotationData && typeof next.annotationData === 'object' && 'lockedBy' in next.annotationData) {
    next.annotationData = { ...next.annotationData };
    delete next.annotationData.lockedBy;
  }
  return next;
}

// The mark's CONTENT as JSON with every lock stamp left out — "is the only
// difference between two versions the lock itself?". A callout's content is
// its data.legacyCallout (the group around it is re-projected from it on every
// callout save, so its derived geometry / normalized coords / meta can be
// rewritten without anyone touching the callout); author meta is identity,
// not content.
const LOCK_KEYS = new Set(['lockedBy']);
function jsonWithoutLock(object) {
  if (!object || typeof object !== 'object') return JSON.stringify(object ?? null);
  const source = object?.data?.type === 'callout' && object?.data?.legacyCallout
    ? object.data.legacyCallout
    : object;
  return JSON.stringify(source, (key, value) => {
    if (LOCK_KEYS.has(key)) return undefined;
    if (key === 'meta' && source === object.data?.legacyCallout) return undefined;
    return value;
  });
}

/**
 * The save guard. Compares a page's objects before and after a save and
 * undoes, inside the save, every change the lock forbids:
 *   - a locked mark that was removed goes back in its old slot;
 *   - a locked mark whose content changed goes back to how it was (a change
 *     that ONLY adds / removes / changes the lock is a lock toggle — allowed
 *     for its author or the document owner);
 *   - an unlocked mark that gains a lock keeps it only when the viewer may
 *     lock it.
 * Order changes are allowed (restacking is not "moving" the mark).
 * Objects without a stable id are not guarded (a lock is only ever written on
 * a mark with an id).
 *
 * @param {object} args
 *   previousObjects  the page's objects before the save
 *   nextObjects      the objects the save wants to write
 *   viewerId, documentOwnerId
 * @returns {{ objects: Array, blockedIds: string[], changed: boolean }}
 *   `objects` is `nextObjects` itself when nothing was blocked.
 */
export function guardLockedMarksOnSave({
  previousObjects,
  nextObjects,
  viewerId = null,
  documentOwnerId = null,
}) {
  const before = Array.isArray(previousObjects) ? previousObjects : [];
  const after = Array.isArray(nextObjects) ? nextObjects : [];
  const blockedIds = [];

  // Fast path: nothing locked before, nothing locked after.
  const anyLockedBefore = before.some((object) => getMarkLockedBy(object) != null);
  const anyLockedAfter = after.some((object) => getMarkLockedBy(object) != null);
  if (!anyLockedBefore && !anyLockedAfter) {
    return { objects: nextObjects, blockedIds, changed: false };
  }

  const beforeById = new Map();
  before.forEach((object, index) => {
    const id = lockMarkIdOf(object);
    if (id != null && !beforeById.has(id)) beforeById.set(id, { object, index });
  });
  const mayToggle = (object) => canToggleLock({ annotation: object, viewerId, documentOwnerId });

  let result = null; // copy-on-write
  const out = () => {
    if (!result) result = after.slice();
    return result;
  };

  const seen = new Set();
  after.forEach((object, index) => {
    const id = lockMarkIdOf(object);
    if (id == null) return;
    seen.add(id);
    const prior = beforeById.get(id)?.object;
    if (prior === object) return; // untouched (same object) — nothing to check
    const priorLock = prior ? getMarkLockedBy(prior) : null;
    const nextLock = getMarkLockedBy(object);
    if (prior && priorLock) {
      const sameContent = jsonWithoutLock(prior) === jsonWithoutLock(object);
      if (!sameContent) {
        // A locked mark's content never changes — not even in the same save
        // that unlocks it (unlock first, then edit).
        out()[index] = prior;
        blockedIds.push(id);
        return;
      }
      // Unlock (or re-lock) by its author / the owner; a new stamp must be
      // the viewer's own id.
      if (nextLock !== priorLock && (!mayToggle(prior) || (nextLock && nextLock !== viewerId))) {
        out()[index] = prior;
        blockedIds.push(id);
      }
      return;
    }
    if (nextLock && (!mayToggle(prior || object) || nextLock !== viewerId)) {
      // Gaining a lock (or a new mark arriving locked) needs the right to lock.
      out()[index] = prior && !getMarkLockedBy(prior) ? prior : withMarkLock(object, null);
      blockedIds.push(id);
    }
  });

  // Locked marks the save removed go back where they were.
  const missing = [];
  for (const [id, { object, index }] of beforeById) {
    if (seen.has(id) || !getMarkLockedBy(object)) continue;
    missing.push({ id, object, index });
  }
  if (missing.length > 0) {
    const list = out();
    missing.sort((a, b) => a.index - b.index);
    for (const { id, object, index } of missing) {
      list.splice(Math.min(index, list.length), 0, object);
      blockedIds.push(id);
    }
  }

  return result
    ? { objects: result, blockedIds, changed: true }
    : { objects: nextObjects, blockedIds, changed: false };
}
