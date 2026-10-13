// src/services/annotationStoreCompaction.js
//
// One-time shrink of a document's annotation store (w33, 2026-09-25).
// Design note: docs/ANNOTATION-FIELD-SYNC.md ("Small snapshots").
//
// Every open downloads the document's checkpoint. "Package 2 - Rev 4 --
// IC.pdf" had a 21.6 MB store (5.5 MB gzipped): ~3.5 MB was the old
// pre-rebuild `annotations` map (already carried into `marks` by w28) and
// most of the rest was imported ink stored 4-5 ways per mark. New writes are
// already compact (annotationMarkCodec.js); this pass rewrites what is
// already stored, with ordinary Yjs deletes:
//
//   * the old `annotations` map's entries are deleted once the w28 carry-over
//     is finished (its marker is present, or it has nothing to carry). A
//     screen that holds the marker also holds every carried mark (the marker
//     is a later write by the same screen), so nothing is lost. Older builds
//     that read only that map are unsupported (owner ruling 2026-09-24).
//   * each mark drops the fields the store no longer keeps and turns
//     polygons its own path reproduces exactly into the short marker
//     (compactStoredMark: only those keys are touched).
//
// Why deletes are enough: every Y.Doc here garbage-collects deleted content
// (gc on), so the next checkpoint of the live doc no longer carries it; only
// a tiny tombstone per deleted key stays. Measured on Package 2: in-place
// deletes give 5.85 MB raw / 2.03 MB gzipped, a fresh-doc rewrite of the same
// content 5.60 / 1.97. So no checkpoint rewrite, no change to the WAL, the
// snapshot RPC, at_seq or the checkpoint rules is needed: this is an edit
// like any other (the WAL split cuts it under 256 KB if it is bigger).
//
// Concurrent screens: deletes of the same items commute (two screens doing
// the pass at once converge). A concurrent edit of another field of a mark is
// untouched. A concurrent edit that sets `polygons` competes with the marker
// by Yjs's usual last-writer-wins per key, exactly as two polygon writes did
// before; the marker then reads as the polygons of whichever path and fill
// rule won (it names no rule of its own).
//
// Pure module: runs in Node tests.

import {
  LEGACY_ANNOTATIONS_MAP,
  MARKS_MAP,
  compactStoredMark,
  storedMarkNeedsCompaction,
} from './annotationMarkStore.js';
import { META_MAP } from './annotationDocStore.js';
import {
  legacyMarksCarriedMarker,
  planLegacyMarksCarryOver,
} from './legacyMarksCarryOver.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../utils/embeddedImportGate.js';

// The whole pass is ONE transaction, so ONE update (the sync layer cuts it
// into chained parts under 256 KB when needed, and checkpoints after its last
// part). Package 2: ~130 KB (deletes are ranges; a marker is ~40 bytes).
function legacyEntryCount(doc) {
  return doc.share.has(LEGACY_ANNOTATIONS_MAP) ? doc.getMap(LEGACY_ANNOTATIONS_MAP).size : 0;
}

/**
 * Whether the old map may go: the carry-over is finished (marker), or it has
 * nothing it would ever carry (no user-drawn and no edited PDF mark).
 */
function legacyMapDroppable(doc) {
  if (legacyEntryCount(doc) === 0) return false;
  if (legacyMarksCarriedMarker(doc)) return true;
  const plan = planLegacyMarksCarryOver(doc);
  return plan.user.length === 0 && plan.editedPdf.length === 0;
}

function marksToCompact(doc) {
  const keys = [];
  doc.getMap(MARKS_MAP).forEach((_stored, key) => {
    if (storedMarkNeedsCompaction(doc, key)) keys.push(key);
  });
  return keys;
}

/**
 * The pass waits for the PDF's own embedded import (it saves whole pages built
 * from what the screen held a moment earlier), like the w28 carry-over.
 */
export function annotationStoreCompactionReady(doc) {
  return Boolean(doc.getMap(META_MAP).get(EMBEDDED_IMPORT_MARKER_KEY));
}

/** True when there is anything to shrink. Cheap enough for every open. */
export function annotationStoreCompactionPending(doc) {
  if (legacyMapDroppable(doc)) return true;
  let found = false;
  doc.getMap(MARKS_MAP).forEach((_stored, key) => {
    if (!found && storedMarkNeedsCompaction(doc, key)) found = true;
  });
  return found;
}

/**
 * Shrink the store (see the module comment). Idempotent.
 * Returns { legacyDeleted, marksCompacted, writes, batches }.
 */
export function compactAnnotationStore(doc, { origin = 'local' } = {}) {
  const result = { legacyDeleted: 0, marksCompacted: 0, writes: 0, batches: 0 };
  const dropLegacy = legacyMapDroppable(doc);
  const keys = marksToCompact(doc);
  if (!dropLegacy && keys.length === 0) return result;
  doc.transact(() => {
    if (dropLegacy) {
      const legacy = doc.getMap(LEGACY_ANNOTATIONS_MAP);
      for (const key of [...legacy.keys()]) {
        legacy.delete(key);
        result.legacyDeleted += 1;
      }
    }
    for (const key of keys) {
      const writes = compactStoredMark(doc, key);
      if (writes > 0) {
        result.marksCompacted += 1;
        result.writes += writes;
      }
    }
  }, origin);
  result.batches = 1;
  return result;
}
