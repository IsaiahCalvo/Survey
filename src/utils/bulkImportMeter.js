// src/utils/bulkImportMeter.js
//
// 2026-10-28 (first-open speed). A PDF's own markup is put on screen in one
// go (PDFViewer's embedded import) and then stored by the capture
// (useAnnotationDoc). Storing it in one go froze the page right after it
// appeared: Package 2's 3,055 ink marks took ~2 s in one task. The capture
// now hands the store a few dozen of those marks at a time (the rest stay on
// screen, "held"), and stores the next few in a later task, until none are
// held. Only marks of the import not yet in the store are ever held; the
// user's own edits always go in at once.
//
// Pure module: runs in Node tests.

import { extractAnnotationId } from '../services/annotationDocStore.js';

// One capture's share of the import: about this long, at the speed the last
// share went (the first share assumes ~1 ms per mark).
export const BULK_IMPORT_SLICE_MS = 40;
export const BULK_IMPORT_MIN_MARKS = 20;
export const BULK_IMPORT_MAX_MARKS = 2_000;
const FIRST_SLICE_MS_PER_MARK = 1;

const NO_KEYS = new Set();

/** How many imported marks the next capture stores. */
export function bulkImportSliceSize(msPerMark) {
  const perMark = Number(msPerMark) > 0 ? Number(msPerMark) : FIRST_SLICE_MS_PER_MARK;
  return Math.max(
    BULK_IMPORT_MIN_MARKS,
    Math.min(BULK_IMPORT_MAX_MARKS, Math.floor(BULK_IMPORT_SLICE_MS / perMark)),
  );
}

/**
 * `byPage` with the import's not-yet-stored marks past the first `limit`
 * left out (page order). `bulkKeys`: the import's keys not stored yet;
 * `isStored(key)`: whether the store has the mark anyway (another screen's
 * import of the same PDF). Returns { byPage, held } with `held` the keys left
 * out; `byPage` is the input itself when nothing is.
 */
export function meterBulkImport(byPage, bulkKeys, limit, { isStored = () => false } = {}) {
  if (!byPage || typeof byPage !== 'object' || !bulkKeys || bulkKeys.size === 0) {
    return { byPage, held: NO_KEYS };
  }
  let budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Infinity;
  let out = null;
  let held = null;
  for (const pageKey of Object.keys(byPage)) {
    const page = byPage[pageKey];
    const objects = Array.isArray(page?.objects) ? page.objects : null;
    if (!objects) continue;
    let kept = null;
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
      const key = extractAnnotationId(object);
      const imported = key != null && bulkKeys.has(key) && !isStored(key);
      if (imported && budget <= 0) {
        if (!kept) kept = objects.slice(0, index);
        if (!held) held = new Set();
        held.add(key);
        continue;
      }
      if (imported) budget -= 1;
      if (kept) kept.push(object);
    }
    if (kept) {
      if (!out) out = { ...byPage };
      out[pageKey] = { ...page, objects: kept };
    }
  }
  return { byPage: out || byPage, held: held || NO_KEYS };
}

/**
 * The screen as `nextByPage` (a read of the store) shows it, with the held
 * marks the previous screen had put back where they were: the store does not
 * have them yet, and a read of it must not take them off the screen.
 */
export function keepHeldImportMarks(previousByPage, nextByPage, heldKeys) {
  if (!heldKeys || heldKeys.size === 0 || !previousByPage || !nextByPage) return nextByPage;
  let out = null;
  for (const pageKey of Object.keys(previousByPage)) {
    const previousObjects = Array.isArray(previousByPage[pageKey]?.objects) ? previousByPage[pageKey].objects : null;
    if (!previousObjects) continue;
    const missing = previousObjects.filter((object) => {
      const key = extractAnnotationId(object);
      return key != null && heldKeys.has(key);
    });
    if (missing.length === 0) continue;
    const page = (out || nextByPage)[pageKey];
    const objects = Array.isArray(page?.objects) ? page.objects : [];
    const present = new Set(objects.map(extractAnnotationId).filter((key) => key != null));
    const add = missing.filter((object) => !present.has(extractAnnotationId(object)));
    if (add.length === 0) continue;
    if (!out) out = { ...nextByPage };
    out[pageKey] = { ...(page || {}), objects: [...objects, ...add] };
  }
  return out || nextByPage;
}

/**
 * A turn for the page before the next share: a MessageChannel task, not
 * setTimeout, which browsers throttle (to 1 s and more) in background tabs.
 */
export function nextImportTurn() {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
