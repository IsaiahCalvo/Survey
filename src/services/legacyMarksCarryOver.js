// src/services/legacyMarksCarryOver.js
//
// One-time carry-over of marks drawn on older builds (w28, 2026-09-24).
// Design note: docs/ANNOTATION-FIELD-SYNC.md ("Marks drawn on older builds").
//
// Older builds kept every mark as one plain `{ p, o }` value in the
// `annotations` root map. The per-field store (v3) reads only `marks`, so
// marks drawn before the rebuild stopped showing. The owner wants them back:
// each document copies them into `marks` once.
//
// What is carried:
//   * Marks the user drew: written under their OLD key, so a mark keeps its
//     id, its eraser lanes (shared by every build, keyed by that id) and its
//     counter numbering. A key already in `marks` is never written.
//   * The PDF file's own markup (`isPdfImported`, `pdfAnnotationId`, ...;
//     paste clones drop all of these, see pasteCloneIdentity.js) is owned by
//     the embedded import (embeddedImportGate.js), which re-imports the
//     file's markup once and honours deletion tombstones. Such an entry is
//     NOT carried (older builds keyed some differently, so it would draw
//     twice) - unless the user EDITED it on the old build
//     (`pdfImportedEditState: 'edited'`: moved, resized, partly erased).
//     Then, once the embedded import has run, the old edited copy replaces
//     the re-imported copy's fields (same key as the re-imported copy), but
//     only while that copy is untouched since the import (not stamped
//     edited, no eraser lane, exactly one copy). A copy the user deleted
//     (tombstone) stays deleted; with no copy and no tombstone the old
//     edited mark is carried under its old key.
//
// Race rules (no deletes anywhere; the old map is only read):
//   * Each batch first writes a record of the old keys it handled
//     (LEGACY_MARKS_CARRIED_BATCH_PREFIX in annoMeta), then the marks, in ONE
//     transaction. The record gets the lower Yjs clocks, and Yjs applies one
//     writer's structs in clock order, so any screen that holds a carried
//     mark (and so can see it deleted) also holds its record. A recorded key
//     is never handled again: a carried mark deleted later stays deleted even
//     before the doc-level marker arrives (review A, w28).
//   * The marker (LEGACY_MARKS_CARRIED_MARKER_KEY in annoMeta) is written in
//     its own transaction AFTER everything is handled; it is a fast path
//     (no scan). It is held back while edited PDF marks wait for the
//     embedded import.
//   * Batches of ~BATCH_BYTES of mark JSON per transaction; the sync layer
//     cuts any update over 256 KB into chained parts (annotationUpdateSplit).
//   * Fields go through the store's own writer (writeAnnotationMark), so a
//     carried mark reads back exactly as the old build read it (identity
//     normalization, eraser lanes and counter numbering run on top in
//     docToByPage, as before).
//
// Pure module: imports only 'yjs'-backed store helpers; runs in Node tests.

import * as Y from 'yjs';
import {
  LEGACY_ANNOTATIONS_MAP,
  MARKS_MAP,
  decodeAnnotationEntry,
  isYMap,
  readAnnotationEntry,
  writeAnnotationMark,
} from './annotationMarkStore.js';
import {
  DELETED_PDF_ANNOTATIONS_MAP,
  ERASER_OPS_MAP,
  META_MAP,
  deletedPdfAnnotationStorageKey,
} from './annotationDocStore.js';
import { deepClone } from '../utils/deepClone.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../utils/embeddedImportGate.js';

export const LEGACY_MARKS_CARRIED_MARKER_KEY = 'legacyMarksCarriedIntoMarks';
// annoMeta[`${prefix}${clientID}:${clock}`] = { keys: [...] }, one per batch.
export const LEGACY_MARKS_CARRIED_BATCH_PREFIX = 'legacyMarksCarriedBatch:';

const BATCH_BYTES = 192 * 1024;

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function present(value) {
  return value != null && String(value) !== '';
}

/**
 * A mark the PDF file itself carried (imported by an older build). The same
 * signs the app itself uses for imported markup.
 */
export function isLegacyPdfImportedMark(object) {
  if (!isPlainRecord(object)) return false;
  if (object.isPdfImported === true || object.data?.isPdfImported === true) return true;
  return present(object.pdfAnnotationId)
    || present(object.data?.pdfAnnotationId)
    || present(object.pdfAnnotationType)
    || present(object.data?.pdfAnnotationType);
}

function pdfAnnotationIdOf(object) {
  const id = object?.pdfAnnotationId ?? object?.data?.pdfAnnotationId;
  return present(id) ? String(id) : null;
}

function isEditedPdfMark(object) {
  return object?.pdfImportedEditState === 'edited'
    || object?.data?.pdfImportedEditState === 'edited';
}

/**
 * The { p, o } of one old entry: a plain `{ p, o }` (reference build) or a
 * per-field mark map (the short-lived store-v2 build wrote those into the
 * same map). null for anything unreadable.
 */
export function decodeLegacyEntry(entry) {
  const decoded = isYMap(entry) ? decodeAnnotationEntry(entry) : entry;
  if (!isPlainRecord(decoded)) return null;
  const page = Number(decoded.p);
  if (!Number.isFinite(page) || page < 1 || !isPlainRecord(decoded.o)) return null;
  return { p: page, o: decoded.o };
}

/**
 * Old entries in the old map's order: { user: [{ key, p, o }], editedPdf:
 * [{ key, p, o, pdfAnnotationId }] } plus counts of what is left out.
 */
export function planLegacyMarksCarryOver(doc) {
  const user = [];
  const editedPdf = [];
  let skippedPdf = 0;
  let skippedInvalid = 0;
  if (!doc.share.has(LEGACY_ANNOTATIONS_MAP)) return { user, editedPdf, skippedPdf, skippedInvalid };
  doc.getMap(LEGACY_ANNOTATIONS_MAP).forEach((entry, key) => {
    const decoded = decodeLegacyEntry(entry);
    if (!decoded) { skippedInvalid += 1; return; }
    const item = { key: String(key), p: decoded.p, o: decoded.o };
    if (!isLegacyPdfImportedMark(decoded.o)) { user.push(item); return; }
    const pdfAnnotationId = pdfAnnotationIdOf(decoded.o);
    if (isEditedPdfMark(decoded.o) && pdfAnnotationId) {
      editedPdf.push({ ...item, pdfAnnotationId });
      return;
    }
    skippedPdf += 1;
  });
  return { user, editedPdf, skippedPdf, skippedInvalid };
}

export function legacyMarksCarriedMarker(doc) {
  return doc.getMap(META_MAP).get(LEGACY_MARKS_CARRIED_MARKER_KEY) || null;
}

/** Every old key some screen's carry-over batch has recorded as handled. */
export function legacyCarriedKeys(doc) {
  const keys = new Set();
  doc.getMap(META_MAP).forEach((value, metaKey) => {
    if (typeof metaKey !== 'string' || !metaKey.startsWith(LEGACY_MARKS_CARRIED_BATCH_PREFIX)) return;
    for (const key of Array.isArray(value?.keys) ? value.keys : []) keys.add(String(key));
  });
  return keys;
}

function embeddedImportDone(doc) {
  return Boolean(doc.getMap(META_MAP).get(EMBEDDED_IMPORT_MARKER_KEY));
}

/**
 * Whether the carry-over should wait for the PDF's own embedded import (its
 * marker is not there yet). The import saves whole pages built from what the
 * screen held a moment earlier, so a carry-over published while it runs can
 * be painted over on screen (the store keeps the marks; they would show only
 * after the next change or open), and edited PDF marks need the re-imported
 * copies. The caller waits for this screen's import pass, or a timeout.
 */
export function legacyCarryOverWaitsForEmbeddedImport(doc) {
  return !embeddedImportDone(doc);
}

/**
 * True when this document has an old mark still to handle now: no marker,
 * and a user-drawn key neither in `marks` nor recorded, or (once the embedded
 * import has run) an edited PDF mark not recorded. Cheap: one pass over the
 * old map reading a few flags per entry.
 */
export function legacyMarksCarryOverPending(doc) {
  if (legacyMarksCarriedMarker(doc)) return false;
  if (!doc.share.has(LEGACY_ANNOTATIONS_MAP)) return false;
  const marks = doc.getMap(MARKS_MAP);
  const importDone = embeddedImportDone(doc);
  let carried = null;
  let found = false;
  doc.getMap(LEGACY_ANNOTATIONS_MAP).forEach((entry, rawKey) => {
    if (found) return;
    const decoded = decodeLegacyEntry(entry);
    if (!decoded) return;
    const key = String(rawKey);
    if (isLegacyPdfImportedMark(decoded.o)) {
      if (!importDone || !isEditedPdfMark(decoded.o) || !pdfAnnotationIdOf(decoded.o)) return;
    } else if (marks.has(key)) {
      return;
    }
    carried ??= legacyCarriedKeys(doc);
    if (!carried.has(key)) found = true;
  });
  return found;
}

// page|pdfAnnotationId -> [keys in `marks`] (built only when needed).
function indexPdfCopies(doc) {
  const index = new Map();
  doc.getMap(MARKS_MAP).forEach((_stored, key) => {
    const entry = readAnnotationEntry(doc, key);
    const id = pdfAnnotationIdOf(entry?.o);
    if (!id) return;
    const slot = `${Number(entry.p)}|${id}`;
    if (!index.has(slot)) index.set(slot, []);
    index.get(slot).push(String(key));
  });
  return index;
}

function hasEraserLane(doc, storageKey) {
  let found = false;
  doc.getMap(ERASER_OPS_MAP).forEach((lane) => {
    if (!found && lane && String(lane.storageKey) === String(storageKey)) found = true;
  });
  return found;
}

/**
 * Decide what one edited PDF mark becomes (import done):
 *   { action: 'replace', targetKey, next } the untouched re-imported copy
 *                                          takes the old edited fields;
 *   { action: 'create', targetKey, next }  no copy and no tombstone;
 *   { action: 'skip', reason }             deleted, edited again, ambiguous.
 */
function resolveEditedPdfMark(doc, item, copiesIndex) {
  const copies = copiesIndex.get(`${item.p}|${item.pdfAnnotationId}`) || [];
  if (copies.length === 0) {
    const tombstone = doc.getMap(DELETED_PDF_ANNOTATIONS_MAP)
      .has(deletedPdfAnnotationStorageKey(item.p, item.pdfAnnotationId));
    if (tombstone) return { action: 'skip', reason: 'deleted' };
    if (doc.getMap(MARKS_MAP).has(item.key)) return { action: 'skip', reason: 'present' };
    return { action: 'create', targetKey: item.key, next: deepClone(item.o) };
  }
  if (copies.length > 1) return { action: 'skip', reason: 'ambiguous' };
  const targetKey = copies[0];
  const copy = readAnnotationEntry(doc, targetKey);
  if (!copy || Number(copy.p) !== Number(item.p)) return { action: 'skip', reason: 'ambiguous' };
  if (isEditedPdfMark(copy.o)) return { action: 'skip', reason: 'edited-again' };
  if (hasEraserLane(doc, targetKey)) return { action: 'skip', reason: 'edited-again' };
  // The old edited fields, under the re-imported copy's identity (the screen
  // and history know the mark by that key).
  const next = deepClone(item.o);
  if (copy.o.id !== undefined) next.id = copy.o.id; else delete next.id;
  const copyDataId = copy.o.data?.id;
  if (copyDataId !== undefined) next.data = { ...(isPlainRecord(next.data) ? next.data : {}), id: copyDataId };
  return { action: 'replace', targetKey, next, before: copy.o };
}

/**
 * Handle every old mark still to handle (see the module comment), then write
 * the marker. Idempotent: with the marker present it does nothing.
 *
 * Returns { status, eligible, carried, alreadyPresent, alreadyCarried,
 * editedPdfReplaced, editedPdfCreated, editedPdfSkipped, editedPdfDeferred,
 * skippedPdf, skippedInvalid, markerWritten, batches }:
 *   status 'already'  the marker was there (nothing written);
 *          'nothing'  no old user-drawn or edited PDF marks (no writes);
 *          'done'     handled what it could (+ marker unless deferred).
 */
export function carryOverLegacyMarks(doc, { origin = 'local', batchBytes = BATCH_BYTES, now = () => new Date().toISOString() } = {}) {
  const base = {
    eligible: 0,
    carried: 0,
    alreadyPresent: 0,
    alreadyCarried: 0,
    editedPdfReplaced: 0,
    editedPdfCreated: 0,
    editedPdfSkipped: 0,
    editedPdfDeferred: 0,
    skippedPdf: 0,
    skippedInvalid: 0,
    markerWritten: false,
    batches: 0,
  };
  if (legacyMarksCarriedMarker(doc)) return { status: 'already', ...base };
  const plan = planLegacyMarksCarryOver(doc);
  const result = {
    ...base,
    eligible: plan.user.length + plan.editedPdf.length,
    skippedPdf: plan.skippedPdf,
    skippedInvalid: plan.skippedInvalid,
  };
  if (result.eligible === 0) return { status: 'nothing', ...result };

  const marks = doc.getMap(MARKS_MAP);
  const meta = doc.getMap(META_MAP);
  const carriedBefore = legacyCarriedKeys(doc);
  const importDone = embeddedImportDone(doc);

  // Work items: { key, size, write(): void } in the old map's order.
  const work = [];
  for (const item of plan.user) {
    if (marks.has(item.key)) { result.alreadyPresent += 1; continue; }
    // Handled before (possibly deleted since): never again.
    if (carriedBefore.has(item.key)) { result.alreadyCarried += 1; continue; }
    work.push({
      key: item.key,
      object: item.o,
      write: () => {
        // Re-checked inside the transaction: never overwrite what is there.
        if (marks.has(item.key)) { result.alreadyPresent += 1; return; }
        writeAnnotationMark(doc, item.key, item.p, deepClone(item.o));
        result.carried += 1;
      },
    });
  }
  let copiesIndex = null;
  for (const item of plan.editedPdf) {
    if (carriedBefore.has(item.key)) { result.alreadyCarried += 1; continue; }
    if (!importDone) { result.editedPdfDeferred += 1; continue; }
    copiesIndex ??= indexPdfCopies(doc);
    work.push({
      key: item.key,
      object: item.o,
      write: () => {
        const decision = resolveEditedPdfMark(doc, item, copiesIndex);
        if (decision.action === 'skip') { result.editedPdfSkipped += 1; return; }
        if (decision.action === 'create') {
          writeAnnotationMark(doc, decision.targetKey, item.p, decision.next);
          result.editedPdfCreated += 1;
          return;
        }
        writeAnnotationMark(doc, decision.targetKey, item.p, decision.next);
        result.editedPdfReplaced += 1;
      },
    });
  }

  let batch = [];
  let batchSize = 0;
  const flush = () => {
    if (batch.length === 0) return;
    const items = batch;
    batch = [];
    batchSize = 0;
    result.batches += 1;
    // A unique record key per batch: this writer's next clock.
    const recordKey = `${LEGACY_MARKS_CARRIED_BATCH_PREFIX}${doc.clientID}:${Y.getState(doc.store, doc.clientID)}`;
    doc.transact(() => {
      // The record first (lower clocks than the marks it names).
      meta.set(recordKey, { keys: items.map(({ key }) => key) });
      for (const item of items) item.write();
    }, origin);
  };
  for (const item of work) {
    let size = 0;
    try { size = JSON.stringify(item.object).length; } catch { size = batchBytes; }
    if (batch.length > 0 && batchSize + size > batchBytes) flush();
    batch.push(item);
    batchSize += size;
  }
  flush();

  // Everything is handled now (or was before), except edited PDF marks that
  // wait for the embedded import. The marker goes in its own transaction.
  if (result.editedPdfDeferred === 0 && !legacyMarksCarriedMarker(doc)) {
    doc.transact(() => {
      meta.set(LEGACY_MARKS_CARRIED_MARKER_KEY, {
        at: now(),
        carried: result.carried,
        editedPdfReplaced: result.editedPdfReplaced,
        eligible: result.eligible,
      });
    }, origin);
    result.markerWritten = true;
  }
  return { status: 'done', ...result };
}

/** Total marks this result changed on screen (for publishing). */
export function legacyCarryOverChangedCount(result) {
  return (Number(result?.carried) || 0)
    + (Number(result?.editedPdfReplaced) || 0)
    + (Number(result?.editedPdfCreated) || 0);
}
