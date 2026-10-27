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

import * as Y from 'yjs';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { bytesToPgHex, gunzipBytes, pgHexToBytes } from './annotationCheckpointCore.js';
import { SURVEY_MARKERS_MAP, docToByPage } from './annotationDocStore.js';

const SNAPSHOT_ENC_GZIP = 2;
const WAL_PAGE = 1000;

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
    const counts = countDocumentMarks(doc);
    if (counts.total === 0) return counts;
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
