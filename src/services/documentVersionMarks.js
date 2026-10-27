// src/services/documentVersionMarks.js
//
// "Upload as new version" brings the old copy's marks across (Drawboard
// Projects' "Reuse"; audit /drawboard-projects item 1, 2026-10-27). Before
// this the new version opened empty and every mark stayed behind on the
// archived old copy, which the archive sweep later deletes.
//
// The old document's whole annotation Y.Doc (marks, survey markers, spaces,
// eraser lanes, stacking order) is read the way the app opens it, snapshot
// then WAL tail, and written to the new document as ONE WAL row, the way the
// connector writes (survey-mcp writeMarkers). Every mark keeps its id, page
// and spot. The row's writer id is fixed per old document, so a retry after a
// lost response replays the same receipt instead of adding a second copy.
//
// Before the write the copy is made ready for the NEW file (prepareCarriedDoc):
//   * marks drawn on older builds, still only in the old `annotations` map,
//     are carried into `marks` first, as the viewer does on open
//     (legacyMarksCarryOver.js); otherwise a document not reopened since the
//     store change would count as empty and its marks stay behind;
//   * the old file's own markup the user never touched is dropped and the
//     "embedded markup imported" note cleared, so the new file's markup is
//     imported on its first open; edited copies stay and keep their ids, so
//     the import skips them instead of drawing them twice.
// These edits use a writer id and clock fixed per old document, so a retry
// sends the same bytes (the server refuses a different payload on a receipt).

import * as Y from 'yjs';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { bytesToPgHex, gunzipBytes, pgHexToBytes } from './annotationCheckpointCore.js';
import { DELETED_PDF_ANNOTATIONS_MAP, META_MAP, SURVEY_MARKERS_MAP, docToByPage } from './annotationDocStore.js';
import { MARKS_MAP, readRawAnnotationEntry } from './annotationMarkStore.js';
import { carryOverLegacyMarks, isLegacyPdfImportedMark } from './legacyMarksCarryOver.js';
import { EMBEDDED_IMPORT_INCOMPLETE_KEY, EMBEDDED_IMPORT_MARKER_KEY } from '../utils/embeddedImportGate.js';

const SNAPSHOT_ENC_GZIP = 2;
const WAL_PAGE = 1000;
const CARRY_ORIGIN = 'version-carry';
// The legacy carry-over stamps a time on its records; a fixed one keeps a
// retry's bytes identical.
const CARRY_CLOCK = '1970-01-01T00:00:00.000Z';

export function versionCarryWriterId(fromDocumentId) {
  return `version-carry-${fromDocumentId}`;
}

/** A document's annotation Y.Doc as stored in the cloud (the caller destroys it). Throws on a failed read. */
export async function loadStoredAnnotationDoc(client, documentId) {
  const doc = createDetachedYDoc(`version-carry:${documentId}`);
  const { data: snap, error: snapError } = await client
    .from('annotation_snapshots')
    .select('snapshot, at_seq, encoding_version')
    .eq('document_id', documentId)
    .maybeSingle();
  if (snapError) throw new Error(`snapshot read failed: ${snapError.message}`);
  let fromSeq = 0;
  if (snap?.snapshot) {
    let bytes = pgHexToBytes(snap.snapshot);
    if (Number(snap.encoding_version) === SNAPSHOT_ENC_GZIP) bytes = await gunzipBytes(bytes);
    Y.applyUpdate(doc, bytes);
    fromSeq = Number(snap.at_seq) || 0;
  }
  for (;;) {
    const { data: rows, error } = await client
      .from('annotation_updates')
      .select('seq, data')
      .eq('document_id', documentId)
      .gt('seq', fromSeq)
      .order('seq', { ascending: true })
      .limit(WAL_PAGE);
    if (error) throw new Error(`update read failed: ${error.message}`);
    if (!rows || rows.length === 0) break;
    for (const row of rows) {
      Y.applyUpdate(doc, pgHexToBytes(row.data));
      fromSeq = Math.max(fromSeq, Number(row.seq));
    }
    if (rows.length < WAL_PAGE) break;
  }
  return doc;
}

// A Yjs writer id fixed per old document (FNV-1a of its id), stepped past
// any writer the stored doc already has.
function carryClientId(doc, fromDocumentId) {
  let hash = 0x811c9dc5;
  for (const ch of String(fromDocumentId)) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let id = hash || 1;
  while (doc.store.clients.has(id)) id = (id + 1) >>> 0 || 1;
  return id;
}

function isEditedImport(object) {
  return object?.pdfImportedEditState === 'edited' || object?.data?.pdfImportedEditState === 'edited';
}

/**
 * Make a loaded old document ready to land on the new file (see the header):
 * carry marks from older builds, drop the old file's untouched markup and
 * clear its import note. Returns { legacyCarried, droppedPdfMarks }.
 */
export function prepareCarriedDoc(doc, fromDocumentId) {
  doc.clientID = carryClientId(doc, fromDocumentId);
  const legacy = carryOverLegacyMarks(doc, { origin: CARRY_ORIGIN, now: () => CARRY_CLOCK });
  let droppedPdfMarks = 0;
  doc.transact(() => {
    const marks = doc.getMap(MARKS_MAP);
    for (const key of [...marks.keys()]) {
      const object = readRawAnnotationEntry(doc, key)?.o;
      if (object && isLegacyPdfImportedMark(object) && !isEditedImport(object)) {
        marks.delete(key);
        droppedPdfMarks += 1;
      }
    }
    const meta = doc.getMap(META_MAP);
    if (meta.has(EMBEDDED_IMPORT_MARKER_KEY)) meta.delete(EMBEDDED_IMPORT_MARKER_KEY);
    if (meta.has(EMBEDDED_IMPORT_INCOMPLETE_KEY)) meta.delete(EMBEDDED_IMPORT_INCOMPLETE_KEY);
  }, CARRY_ORIGIN);
  return { legacyCarried: legacy?.carried || 0, droppedPdfMarks };
}

/** How many marks and survey markers a document holds. */
export function countDocumentMarks(doc) {
  let marks = 0;
  for (const page of Object.values(docToByPage(doc))) marks += page?.objects?.length || 0;
  const surveyMarkers = doc.getMap(SURVEY_MARKERS_MAP).size;
  return { marks, surveyMarkers, total: marks + surveyMarkers };
}

/**
 * Copy every mark of `fromDocumentId` onto `toDocumentId`, same page and spot.
 * Returns the counts copied ({ total: 0 } when the old copy had none, and then
 * nothing is written). Throws when a read or the write fails.
 */
export async function carryMarksToNewVersion({ client, fromDocumentId, toDocumentId }) {
  if (!fromDocumentId || !toDocumentId || fromDocumentId === toDocumentId) {
    throw new Error('carryMarksToNewVersion: two different document ids required');
  }
  const doc = await loadStoredAnnotationDoc(client, fromDocumentId);
  try {
    prepareCarriedDoc(doc, fromDocumentId);
    const counts = countDocumentMarks(doc);
    // Deleted PDF markup still travels: the new file may carry the same
    // annotations, and they stay deleted.
    const tombstones = doc.share.has(DELETED_PDF_ANNOTATIONS_MAP) ? doc.getMap(DELETED_PDF_ANNOTATIONS_MAP).size : 0;
    if (counts.total === 0 && tombstones === 0) return counts;
    const { error } = await client.rpc('append_annotation_update', {
      p_document_id: toDocumentId,
      p_client_id: versionCarryWriterId(fromDocumentId),
      p_client_seq: 1,
      p_data: bytesToPgHex(Y.encodeStateAsUpdate(doc)),
    });
    if (error) throw new Error(`mark copy failed: ${error.message}`);
    return counts;
  } finally {
    doc.destroy();
  }
}
