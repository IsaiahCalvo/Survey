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
// Rules (race-safe by construction, no deletes anywhere):
//   * Only marks the user drew are carried. A mark imported from the PDF file
//     itself (`isPdfImported` / `pdfAnnotationId`; paste clones drop both, see
//     pasteCloneIdentity.js) is owned by the embedded import
//     (embeddedImportGate.js), which re-imports the file's markup once and
//     honours deletion tombstones. Carrying those too would draw them twice
//     (older builds keyed some of them differently).
//   * The key is the old key, so a mark keeps its id, its eraser lanes (shared
//     by every build, keyed by that id) and its counter numbering.
//   * A key already in `marks` is never written: whatever is there (a newer
//     edit, or another screen's carry-over) wins.
//   * The `annotations` map is only read, never changed.
//   * The fields go through the store's own writer (writeAnnotationMark ->
//     the same nested-map layout as any new mark), so a carried mark reads
//     back exactly as the old build read it (identity normalization, eraser
//     lanes and counter numbering run on top in docToByPage, as before).
//   * Writes are batched (~BATCH_BYTES of mark JSON per transaction), so no
//     one update is huge; the sync layer cuts any update over 256 KB into
//     chained parts anyway (annotationUpdateSplit.js).
//   * The marker (LEGACY_MARKS_CARRIED_MARKER_KEY in annoMeta) is written in
//     its own transaction AFTER every carried mark is in `marks`. Yjs applies
//     one writer's changes in clock order, so no peer ever sees the marker
//     without the marks before it. Once the marker exists, the carry-over
//     never runs again, so a carried mark that is later deleted stays deleted.
//
// Pure module: imports only 'yjs'-backed store helpers; runs in Node tests.

import {
  LEGACY_ANNOTATIONS_MAP,
  MARKS_MAP,
  decodeAnnotationEntry,
  isYMap,
  writeAnnotationMark,
} from './annotationMarkStore.js';
import { META_MAP } from './annotationDocStore.js';
import { deepClone } from '../utils/deepClone.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../utils/embeddedImportGate.js';

export const LEGACY_MARKS_CARRIED_MARKER_KEY = 'legacyMarksCarriedIntoMarks';

const BATCH_BYTES = 192 * 1024;

function isPlainRecord(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A mark the PDF file itself carried (imported by an older build). */
export function isLegacyPdfImportedMark(object) {
  if (!isPlainRecord(object)) return false;
  if (object.isPdfImported === true) return true;
  const pdfId = object.pdfAnnotationId ?? object.data?.pdfAnnotationId;
  return pdfId != null && String(pdfId) !== '';
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
 * Old entries this document would carry: [{ key, p, o }] in the old map's
 * order (which is the order the old build painted them in), plus counts of
 * what is left out.
 */
export function planLegacyMarksCarryOver(doc) {
  const legacy = doc.share.has(LEGACY_ANNOTATIONS_MAP)
    ? doc.getMap(LEGACY_ANNOTATIONS_MAP)
    : null;
  const eligible = [];
  let skippedPdf = 0;
  let skippedInvalid = 0;
  if (!legacy) return { eligible, skippedPdf, skippedInvalid };
  legacy.forEach((entry, key) => {
    const decoded = decodeLegacyEntry(entry);
    if (!decoded) { skippedInvalid += 1; return; }
    if (isLegacyPdfImportedMark(decoded.o)) { skippedPdf += 1; return; }
    eligible.push({ key: String(key), p: decoded.p, o: decoded.o });
  });
  return { eligible, skippedPdf, skippedInvalid };
}

export function legacyMarksCarriedMarker(doc) {
  return doc.getMap(META_MAP).get(LEGACY_MARKS_CARRIED_MARKER_KEY) || null;
}

/**
 * True when this document still has old user-drawn marks to carry (no
 * marker yet). Cheap: one pass over the old map, reading two flags per entry.
 */
export function legacyMarksCarryOverPending(doc) {
  if (legacyMarksCarriedMarker(doc)) return false;
  if (!doc.share.has(LEGACY_ANNOTATIONS_MAP)) return false;
  let found = false;
  doc.getMap(LEGACY_ANNOTATIONS_MAP).forEach((entry) => {
    if (found) return;
    const decoded = decodeLegacyEntry(entry);
    if (decoded && !isLegacyPdfImportedMark(decoded.o)) found = true;
  });
  return found;
}

/**
 * Whether the carry-over should run now or wait for the PDF's own embedded
 * import. Old builds imported the PDF's markup at the first open, so the
 * user's marks sat ON TOP of it. The embedded import appends its marks to
 * `marks`, and the page paints in map order, so carrying first would put the
 * user's marks underneath. The caller waits for the import's marker (or a
 * timeout) before carrying.
 */
export function legacyCarryOverWaitsForEmbeddedImport(doc) {
  return !doc.getMap(META_MAP).get(EMBEDDED_IMPORT_MARKER_KEY);
}

/**
 * Carry every old user-drawn mark that `marks` does not hold into `marks`,
 * then write the marker. Idempotent: with the marker present it does nothing.
 *
 * Returns { status, eligible, carried, alreadyPresent, skippedPdf,
 * skippedInvalid, markerWritten, batches }:
 *   status 'already'  the marker was there (nothing written);
 *          'nothing'  no old user-drawn marks (nothing written, no marker);
 *          'done'     carried (possibly 0 if all were present) + marker.
 */
export function carryOverLegacyMarks(doc, { origin = 'local', batchBytes = BATCH_BYTES, now = () => new Date().toISOString() } = {}) {
  const base = {
    eligible: 0,
    carried: 0,
    alreadyPresent: 0,
    skippedPdf: 0,
    skippedInvalid: 0,
    markerWritten: false,
    batches: 0,
  };
  if (legacyMarksCarriedMarker(doc)) return { status: 'already', ...base };
  const plan = planLegacyMarksCarryOver(doc);
  const result = {
    ...base,
    eligible: plan.eligible.length,
    skippedPdf: plan.skippedPdf,
    skippedInvalid: plan.skippedInvalid,
  };
  if (plan.eligible.length === 0) return { status: 'nothing', ...result };

  const marks = doc.getMap(MARKS_MAP);
  let batch = [];
  let batchSize = 0;
  const flush = () => {
    if (batch.length === 0) return;
    const entries = batch;
    batch = [];
    batchSize = 0;
    result.batches += 1;
    doc.transact(() => {
      for (const { key, p, o } of entries) {
        // Re-checked inside the transaction: never overwrite what is there.
        if (marks.has(key)) { result.alreadyPresent += 1; continue; }
        writeAnnotationMark(doc, key, p, deepClone(o));
        result.carried += 1;
      }
    }, origin);
  };
  for (const entry of plan.eligible) {
    if (marks.has(entry.key)) { result.alreadyPresent += 1; continue; }
    let size = 0;
    try { size = JSON.stringify(entry.o).length; } catch { size = batchBytes; }
    if (batch.length > 0 && batchSize + size > batchBytes) flush();
    batch.push(entry);
    batchSize += size;
  }
  flush();

  // Every eligible mark is in `marks` now (carried here or already there).
  // The marker goes in its own, later transaction.
  if (!legacyMarksCarriedMarker(doc)) {
    doc.transact(() => {
      doc.getMap(META_MAP).set(LEGACY_MARKS_CARRIED_MARKER_KEY, {
        at: now(),
        carried: result.carried,
        eligible: result.eligible,
      });
    }, origin);
    result.markerWritten = true;
  }
  return { status: 'done', ...result };
}
