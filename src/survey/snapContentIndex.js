/**
 * snapContentIndex.js — one Snap to content index per pdf.js page (Nightly
 * 'snap-content').
 *
 * Built lazily, the first time snapping needs the page (a snapping tool armed
 * with the page on screen, or the first drawn point). Cached per document
 * (the pdf.js document object: a new version is a new object) and page. The
 * operator list comes from pdf.js's worker; reading it into the grid runs in
 * short slices between idle callbacks, so a dense sheet never holds the main
 * thread for long. Capped at SNAP_SEGMENT_CAP pieces: a denser sheet keeps
 * its longest pieces (walls, grid lines, borders) over the short strokes of
 * its text and hatching, whatever order the PDF paints them in.
 */
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createStraightSegmentReader, SNAP_SEGMENT_CAP } from './smartFillVector.js';
import { createSnapContentIndex } from '../utils/snapContent.js';

const SLICE_MS = 8;
const SLICE_OPS = 20000;
const SLICE_ADDS = 512;
// Read at most this many times the cap before choosing which to keep.
const READ_FACTOR = 8;

const byDocument = new WeakMap();

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

function nextSlice() {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 50 });
    else setTimeout(resolve, 0);
  });
}

/**
 * Read an operator list into a fresh index in time slices. Resolves to
 * { index, count, truncated, ms }. `yieldSlice` (tests) replaces the idle wait.
 */
export async function buildSnapContentIndex(operatorList, ops, viewportTransform, {
  maxSegments = SNAP_SEGMENT_CAP,
  sliceMs = SLICE_MS,
  yieldSlice = nextSlice,
} = {}) {
  const started = nowMs();
  const index = createSnapContentIndex();
  const flat = [];
  const reader = createStraightSegmentReader(operatorList, ops, viewportTransform, (x1, y1, x2, y2) => { flat.push(x1, y1, x2, y2); }, { maxSegments: maxSegments * READ_FACTOR });
  while (!reader.done) {
    // At least one operator per slice, so a zero budget still moves on.
    reader.step(1);
    reader.step(SLICE_OPS, nowMs() + sliceMs, nowMs);
    if (!reader.done) await yieldSlice();
  }
  const read = flat.length / 4;
  // Over the cap: keep the longest. A point (a curve's or a short run's
  // end) counts as one unit long.
  const weight = (i) => Math.max(1, Math.hypot(flat[4 * i + 2] - flat[4 * i], flat[4 * i + 3] - flat[4 * i + 1]));
  let keepAbove = -Infinity;
  let tiesLeft = Infinity;
  if (read > maxSegments) {
    const weights = new Float64Array(read);
    for (let i = 0; i < read; i += 1) weights[i] = weight(i);
    weights.sort();
    const cut = weights[read - maxSegments];
    keepAbove = cut;
    tiesLeft = 0;
    for (let i = read - maxSegments; i < read && weights[i] === cut; i += 1) tiesLeft += 1;
    await yieldSlice();
  }
  let i = 0;
  while (i < read) {
    const sliceEnd = nowMs() + sliceMs;
    do {
      const stop = Math.min(read, i + SLICE_ADDS);
      for (; i < stop; i += 1) {
        const w = read > maxSegments ? weight(i) : Infinity;
        if (w < keepAbove) continue;
        if (w === keepAbove) { if (tiesLeft <= 0) continue; tiesLeft -= 1; }
        index.add(flat[4 * i], flat[4 * i + 1], flat[4 * i + 2], flat[4 * i + 3]);
      }
    } while (i < read && nowMs() < sliceEnd);
    if (i < read) await yieldSlice();
  }
  return { index, count: index.size, read, truncated: read > maxSegments || reader.truncated, ms: nowMs() - started };
}

/**
 * The page's index when it is ready, else null (and the build is started).
 * `onReady` is called once the build finishes.
 */
export function getPageSnapContentIndex(pdfDocument, pageNumber, { onReady = null } = {}) {
  if (!pdfDocument || typeof pdfDocument.getPage !== 'function' || !(Number(pageNumber) > 0)) return null;
  let pages = byDocument.get(pdfDocument);
  if (!pages) { pages = new Map(); byDocument.set(pdfDocument, pages); }
  let entry = pages.get(pageNumber);
  if (!entry) {
    entry = { index: null, failed: false, waiting: new Set() };
    pages.set(pageNumber, entry);
    (async () => {
      const pdfPage = await pdfDocument.getPage(pageNumber);
      // pdf.js AnnotationMode.DISABLE: imported markups are not the drawing.
      const list = await pdfPage.getOperatorList({ intent: 'display', annotationMode: 0 });
      return buildSnapContentIndex(list, OPS, pdfPage.getViewport({ scale: 1 }).transform);
    })().then((built) => {
      entry.index = built.index;
      entry.stats = { count: built.count, read: built.read, truncated: built.truncated, ms: built.ms };
    }, () => { entry.failed = true; }).finally(() => {
      const waiting = [...entry.waiting];
      entry.waiting.clear();
      waiting.forEach((fn) => { try { fn(entry.index); } catch { /* listener */ } });
    });
  }
  if (entry.index) return entry.index;
  if (onReady && !entry.failed) entry.waiting.add(onReady);
  return null;
}
