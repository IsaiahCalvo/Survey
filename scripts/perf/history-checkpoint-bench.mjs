// Cost of one full undo checkpoint (PDFViewer addHistoryCheckpoint, the path
// a Survey Marker move / delete, a space edit or an eraser gesture takes) on a
// big drawing set: snapshot the marks, fingerprint the snapshot and the last
// checkpoint for the duplicate check, then build the checkpoint's summary and
// delta. Synthetic document sized like Package 2 (~22 MB of marks as JSON).
//
//   node scripts/perf/history-checkpoint-bench.mjs
//   PAGES=36 MARKS=85 SEGMENTS=120 RUNS=7 node scripts/perf/history-checkpoint-bench.mjs
import { deepClone } from '../../src/utils/deepClone.js';
import { snapshotAnnotationPages } from '../../src/utils/historySnapshotShare.js';
import * as history from '../../src/utils/historyHelpers.js';

const PAGES = Number(process.env.PAGES || 36);
const MARKS = Number(process.env.MARKS || 85);
const SEGMENTS = Number(process.env.SEGMENTS || 120);
const RUNS = Number(process.env.RUNS || 7);

const inkMark = (page, i) => ({
  type: 'path',
  left: i * 3.1,
  top: page * 2.7,
  stroke: '#e53935',
  strokeWidth: 2,
  path: Array.from({ length: SEGMENTS }, (_, k) => ['Q', i + k * 1.37, page + k * 0.71, i + k * 1.41, page + k * 0.73]),
  data: { id: `p${page}-m${i}`, type: 'ink', author: 'bench', createdAt: '2026-10-22T00:00:00.000Z' },
});
let byPage = {};
for (let p = 1; p <= PAGES; p += 1) byPage[String(p)] = { objects: Array.from({ length: MARKS }, (_, i) => inkMark(p, i)), version: 1 };
const surveyMarkers = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`m${i}`, { id: `m${i}`, page: 1 + (i % PAGES), x: i, y: i * 2, categoryId: 'c1', fields: { status: 'open' } }]));
const spaces = [{ id: 's1', name: 'Level 2', assignedPages: [{ pageNumber: 1, regions: [{ x: 0, y: 0, w: 10, h: 10 }] }] }];

const snapshot = () => ({
  annotationsByPage: snapshotAnnotationPages(byPage, deepClone),
  surveyMarkers: deepClone(surveyMarkers),
  spaces: deepClone(spaces),
  callouts: [],
  pendingSurveyMarkerUi: null,
});

// The same steps, in order, as the full checkpoint path.
const undo = [];
function checkpoint() {
  const current = snapshot();
  const fp = history.getHistoryFingerprint(current);
  const last = undo[undo.length - 1];
  const lastFp = last ? history.getHistoryFingerprint(last) : null;
  const duplicate = history.historyFingerprintsEqual
    ? (last && history.historyFingerprintsEqual(lastFp, fp))
    : (last && lastFp.serialized === fp.serialized);
  if (duplicate) return 'duplicate';
  const metaFp = history.getHistoryFingerprint(current);
  const meta = {
    summary: history.summarizeHistorySnapshot(current),
    delta: history.summarizeHistoryDelta(last || null, current),
    snapshotHash: metaFp.hash,
    snapshotBytes: metaFp.bytes,
  };
  undo.push(current);
  return meta;
}

// Move one survey marker / one mark per step, like a user editing.
const times = [];
let lastMeta = null;
checkpoint();
for (let r = 0; r < RUNS; r += 1) {
  const key = String(1 + (r % PAGES));
  const page = byPage[key];
  byPage = { ...byPage, [key]: { ...page, objects: page.objects.map((o, i) => (i === 0 ? { ...o, left: o.left + 1 } : o)) } };
  surveyMarkers.m0.x += 1;
  const t0 = performance.now();
  lastMeta = checkpoint();
  times.push(performance.now() - t0);
}
// A checkpoint with nothing changed (the duplicate check).
const t0 = performance.now();
const dup = checkpoint();
const dupMs = performance.now() - t0;

times.sort((a, b) => a - b);
console.log(JSON.stringify({
  docMB: +(lastMeta.snapshotBytes / 1e6).toFixed(1),
  medianMs: +times[Math.floor(times.length / 2)].toFixed(1),
  minMs: +times[0].toFixed(1),
  duplicateMs: +dupMs.toFixed(1),
  duplicateDetected: dup === 'duplicate',
  changedPages: lastMeta.delta.changedPagesPreview,
  objectDelta: lastMeta.delta.annotationObjectDelta,
}));
