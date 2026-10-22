/**
 * smartFillProvider.js — the beta Smart fill provider (owner 2026-10-20).
 *
 * Registers with markerShapeProviders.js when the beta flag is on
 * (smartFillFlag.js). A tap is answered, in order, by:
 *   1. the PDF's own drawing (smartFillVector.js): the closed path around the
 *      tap. Exact on vector shop drawings (Schneider tags are real circles),
 *      however the tag touches walls, leader lines or the next tag.
 *   2. the pixels around the tap (smartFillEngine.js), first looking for a
 *      tag shape the user taught (smartFillTemplates.js), then flood fill.
 * Returns { polygons } in page units, or null with `reason` reported through
 * onNoMatch so the page can say "No outline found".
 */
import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { registerMarkerShapeProvider } from './markerShapeProviders.js';
import { adaptiveInkMaskFromRgba, findSimilarTags, outlineSignature, signaturesMatch, traceOuterLoop } from './smartFillEngine.js';
import { extractClosedShapes, pickShapeAtPoint, pixelsBeatVector, shapeToPolygon, vectorAnswerIsTagSized } from './smartFillVector.js';
import { findOutlineWithTemplates, outlineFromBox, vectorShapeMatchesTemplate } from './smartFillTemplates.js';
import { getSmartFillTemplateShapes } from './smartFillTemplateShapes.js';

// --- The page's own drawing ---------------------------------------------------
// One read per page (pdf.js hands back its cached operator list when it has
// one); the closed tag-sized paths are kept for every later tap.
const vectorCache = new WeakMap();

export function getPageVectorShapes(pdfPage) {
  if (!pdfPage || typeof pdfPage.getOperatorList !== 'function' || typeof pdfPage.getViewport !== 'function') return Promise.resolve(null);
  let job = vectorCache.get(pdfPage);
  if (!job) {
    job = (async () => {
      // pdf.js AnnotationMode.DISABLE: imported markups are not the drawing.
      const list = await pdfPage.getOperatorList({ intent: 'display', annotationMode: 0 });
      return extractClosedShapes(list, OPS, pdfPage.getViewport({ scale: 1 }).transform);
    })().catch(() => null);
    vectorCache.set(pdfPage, job);
  }
  return job;
}

/** Start reading a page's drawing before the first tap (Smart fill armed). */
export function prewarmSmartFillPage(pdfPage) {
  void getPageVectorShapes(pdfPage);
}

async function vectorShapesBy(pdfPage, deadline) {
  const job = getPageVectorShapes(pdfPage);
  const wait = Math.max(0, deadline - Date.now());
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), wait); });
  try {
    return await Promise.race([job, late]);
  } finally {
    clearTimeout(timer);
  }
}

// Window around the tap, page units (1 = 1 PDF point; a tag is ~10-80 pt).
const WINDOW_PAGE_UNITS = 360;
// Pixel cap per side so one tap stays quick on a big zoom.
const MAX_WINDOW_PX = 1200;

// UX: a tap answers fast or not at all; past this the toast says so.
const TIME_LIMIT_MS = 2500;
// ...except the page's first read of its drawing, which may take longer.
const LATE_VECTOR_LIMIT_MS = 8000;

/** Crop the rendered page around the tap. Returns pixels + the mapping back. */
export function cropAroundTap({ point, pageSize, pageCanvas }) {
  if (!pageCanvas || !pageSize?.width || !pageCanvas.width) return null;
  // A canvas that isn't drawn yet (pdf.js placeholder) has the wrong shape.
  if (Math.abs(pageCanvas.width / pageCanvas.height - pageSize.width / pageSize.height) > 0.02 * (pageSize.width / pageSize.height)) return null;
  const pxPerUnit = pageCanvas.width / pageSize.width;
  const half = WINDOW_PAGE_UNITS / 2;
  const left = Math.max(0, point.x - half);
  const top = Math.max(0, point.y - half);
  const right = Math.min(pageSize.width, point.x + half);
  const bottom = Math.min(pageSize.height, point.y + half);
  const srcW = (right - left) * pxPerUnit;
  const srcH = (bottom - top) * pxPerUnit;
  if (!(srcW > 0 && srcH > 0)) return null;
  const scale = Math.min(1, MAX_WINDOW_PX / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(pageCanvas, left * pxPerUnit, top * pxPerUnit, srcW, srcH, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const unitsPerPx = 1 / (pxPerUnit * scale);
  return {
    rgba: data,
    width,
    height,
    seedX: (point.x - left) / unitsPerPx,
    seedY: (point.y - top) / unitsPerPx,
    pxPerUnit: 1 / unitsPerPx,
    toPage: ([x, y]) => [left + x * unitsPerPx, top + y * unitsPerPx],
  };
}

// Fixed detail for a tap: 3 px per page unit, whatever the zoom. A tag is
// often 10-30 units, so it gets 30-90 px to work with even on a phone at 15%.
const RENDER_PX_PER_UNIT = 3;

/**
 * Draw the window around the tap straight from the PDF at a fixed detail, so
 * Smart fill works the same at every zoom (the screen canvas at phone zoom
 * can leave a tag only a few pixels wide). Null when pdf.js isn't available;
 * the caller then reads the screen canvas instead.
 */
export async function renderCropFromPdf({ point, pageSize, pdfPage, signal, deadline = null, box = null }) {
  if (!pdfPage || typeof pdfPage.getViewport !== 'function' || !pageSize?.width || typeof document === 'undefined') return null;
  const half = WINDOW_PAGE_UNITS / 2;
  // `box` (page units) draws exactly that box instead of a window round the tap.
  const left = Math.max(0, box ? box.x : point.x - half);
  const top = Math.max(0, box ? box.y : point.y - half);
  const right = Math.min(pageSize.width, box ? box.x + box.width : point.x + half);
  const bottom = Math.min(pageSize.height, box ? box.y + box.height : point.y + half);
  if (!(right > left && bottom > top)) return null;
  const k = RENDER_PX_PER_UNIT;
  const width = Math.max(1, Math.round((right - left) * k));
  const height = Math.max(1, Math.round((bottom - top) * k));
  try {
    const viewport = pdfPage.getViewport({ scale: k });
    const work = document.createElement('canvas');
    work.width = width;
    work.height = height;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    const task = pdfPage.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -left * k, -top * k], background: 'white',
      // pdf.js AnnotationMode.DISABLE: leave imported markups out of the
      // crop, like the page render in PdfjsViewerContainer.
      annotationMode: 0 });
    const onAbort = () => task.cancel?.();
    signal?.addEventListener?.('abort', onAbort);
    const expiry = deadline != null ? setTimeout(onAbort, Math.max(0, deadline - Date.now())) : null;
    try {
      await task.promise;
    } finally {
      clearTimeout(expiry);
      signal?.removeEventListener?.('abort', onAbort);
    }
    const { data } = ctx.getImageData(0, 0, width, height);
    return {
      rgba: data,
      width,
      height,
      seedX: point ? (point.x - left) * k : 0,
      seedY: point ? (point.y - top) * k : 0,
      pxPerUnit: k,
      toPage: ([x, y]) => [left + x / k, top + y / k],
    };
  } catch {
    return null;
  }
}

function toPolygons(found, crop) {
  if (!found?.ok) return { ok: false, reason: found?.reason || 'open' };
  return { ok: true, polygons: { type: 'Polygon', coordinates: [found.ring.map(crop.toPage)] } };
}

/** Same-thread run (tests, and browsers with no module workers). */
export function readSmartFillOutline(context) {
  const crop = cropAroundTap(context);
  if (!crop) return { ok: false, reason: 'not-ready' };
  const mask = adaptiveInkMaskFromRgba(crop.rgba, crop.width, crop.height);
  const templates = context.templates ?? getSmartFillTemplateShapes();
  return toPolygons(findOutlineWithTemplates(mask, crop.width, crop.height, crop.seedX, crop.seedY, templates, crop.pxPerUnit), crop);
}

let worker = null;
let workerBroken = false;
let nextId = 1;
function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./smartFillWorker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('error', () => { workerBroken = true; worker = null; });
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

/** Pixels only, off-thread with a time limit; falls back to same-thread. */
async function readPixelOutline(context, deadline, templates) {
  const crop = (await renderCropFromPdf({ ...context, deadline })) || cropAroundTap(context);
  if (context.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (Date.now() >= deadline) return { ok: false, reason: 'timeout' };
  if (!crop) return { ok: false, reason: 'not-ready' };
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (!w) {
    const mask = adaptiveInkMaskFromRgba(crop.rgba, crop.width, crop.height);
    return toPolygons(findOutlineWithTemplates(mask, crop.width, crop.height, crop.seedX, crop.seedY, templates, crop.pxPerUnit), crop);
  }
  const id = nextId++;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      context.signal?.removeEventListener?.('abort', onAbort);
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.data?.id === id) finish(toPolygons(event.data.result, crop));
    };
    const onAbort = () => finish({ ok: false, reason: 'aborted' });
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), Math.max(0, deadline - Date.now()));
    w.addEventListener('message', onMessage);
    context.signal?.addEventListener?.('abort', onAbort);
    const buffer = crop.rgba.buffer.slice(0);
    w.postMessage({
      id, rgba: buffer, width: crop.width, height: crop.height, seedX: crop.seedX, seedY: crop.seedY,
      templates, pxPerUnit: crop.pxPerUnit,
    }, [buffer]);
  });
}

/** One tap: the drawing's own outline first, then the pixels. */
export async function readSmartFillOutlineAsync(context) {
  // The time limit covers the PDF reads and render too.
  const start = Date.now();
  const deadline = start + TIME_LIMIT_MS;
  const templates = context.templates ?? getSmartFillTemplateShapes();
  const { point } = context;
  const pick = (shapes) => (shapes?.length
    ? pickShapeAtPoint(shapes, point, { prefer: templates.length ? (v) => vectorShapeMatchesTemplate(v, templates) : null })
    : null);
  // The drawing gets most of the time; the pixels keep at least 1 s.
  let shapes = context.pdfPage ? await vectorShapesBy(context.pdfPage, deadline - 1000) : null;
  if (context.signal?.aborted) return { ok: false, reason: 'aborted' };
  let picked = pick(shapes);
  if (vectorAnswerIsTagSized(picked)) {
    return { ok: true, polygons: shapeToPolygon(picked), method: 'vector' };
  }
  const pixels = await readPixelOutline(context, deadline, templates);
  if (context.signal?.aborted) return { ok: false, reason: 'aborted' };
  // A big page's first read can outrun the tap's time; when the pixels
  // can't answer, the drawing is still the right answer, just later.
  if (!shapes && context.pdfPage && !pixels.ok) {
    shapes = await vectorShapesBy(context.pdfPage, start + LATE_VECTOR_LIMIT_MS);
    if (context.signal?.aborted) return { ok: false, reason: 'aborted' };
    picked = pick(shapes);
    if (vectorAnswerIsTagSized(picked)) return { ok: true, polygons: shapeToPolygon(picked), method: 'vector' };
  }
  if (!picked) return pixels.ok ? { ...pixels, method: 'pixels' } : pixels;
  if (pixels.ok && pixelsBeatVector(picked, pixels.polygons.coordinates[0])) return { ...pixels, method: 'pixels' };
  return { ok: true, polygons: shapeToPolygon(picked), method: 'vector' };
}

// The whole page at most this many px on its long side for a scan.
const MAX_SCAN_PX = 2400;
const SCAN_TIME_LIMIT_MS = 15000;

// Page scans run one at a time, each on its own worker, so a tap (2.5s limit)
// never waits behind a scan and one page's abort or timeout never kills another
// page's scan. The time limit starts when a scan actually runs, not when queued.
let scanQueue = Promise.resolve();

function runScan(message, transfer, signal, limitMs) {
  if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'aborted' });
  let w;
  try {
    w = new Worker(new URL('./smartFillWorker.js', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve({ ok: false, reason: 'no-worker' });
  }
  const id = nextId++;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      w.terminate();
      resolve(value);
    };
    const onAbort = () => finish({ ok: false, reason: 'aborted' });
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), limitMs);
    w.addEventListener('message', (event) => { if (event.data?.id === id) finish(event.data.result); });
    w.addEventListener('error', () => finish({ ok: false, reason: 'error' }));
    signal?.addEventListener?.('abort', onAbort);
    w.postMessage({ ...message, id }, transfer);
  });
}

function postToWorker(message, transfer, signal, limitMs) {
  if (typeof Worker === 'undefined' || workerBroken) return null;
  const job = scanQueue.then(() => runScan(message, transfer, signal, limitMs));
  scanQueue = job.catch(() => {});
  return job;
}

/**
 * Find the tags on a page that match a saved sample (page units) or any
 * taught tag shape. Vector pages: every closed path with the same shape and
 * size. Otherwise the page's pixels. Resolves to
 * { ok:true, polygons: [GeoJSON Polygon, ...] } or { ok:false, reason }.
 */
export async function findSimilarOnPage({ pageCanvas, pageSize, sample, pdfPage = null, templates = null, signal = null }) {
  const taught = templates ?? getSmartFillTemplateShapes();
  const samples = [sample, ...taught].filter((s) => s?.width > 0);
  if (!samples.length) return { ok: false, reason: 'not-ready' };
  const shapes = pdfPage ? await getPageVectorShapes(pdfPage) : null;
  if (signal?.aborted) return { ok: false, reason: 'aborted' };
  if (shapes?.length) {
    const found = shapes.filter((v) => {
      const sig = v.signature || (v.signature = outlineSignature(v.ring));
      return (sample?.width > 0 && signaturesMatch(sig, sample)) || vectorShapeMatchesTemplate(v, taught);
    });
    if (found.length) return { ok: true, polygons: found.map(shapeToPolygon) };
  }
  if (!pageCanvas || !pageSize?.width || !pageCanvas.width) return { ok: false, reason: 'not-ready' };
  if (Math.abs(pageCanvas.width / pageCanvas.height - pageSize.width / pageSize.height) > 0.02 * (pageSize.width / pageSize.height)) {
    return { ok: false, reason: 'not-ready' };
  }
  const scale = Math.min(1, MAX_SCAN_PX / Math.max(pageCanvas.width, pageCanvas.height));
  const width = Math.max(1, Math.round(pageCanvas.width * scale));
  const height = Math.max(1, Math.round(pageCanvas.height * scale));
  const work = document.createElement('canvas');
  work.width = width;
  work.height = height;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(pageCanvas, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const pxPerUnit = width / pageSize.width;
  const pxSamples = samples.map((s) => ({ ...s, width: s.width * pxPerUnit, height: s.height * pxPerUnit }));
  const buffer = data.buffer;
  const pending = postToWorker({ kind: 'scan', rgba: buffer, width, height, samples: pxSamples, templates: taught, pxPerUnit }, [buffer], signal, SCAN_TIME_LIMIT_MS);
  let result = pending ? await pending : null;
  if (!result || result.reason === 'no-worker') {
    result = { ok: true, rings: findSimilarTags(adaptiveInkMaskFromRgba(data, width, height), width, height, pxSamples, { templates: taught, pxPerUnit, outlineAt: findOutlineWithTemplates }) };
  }
  if (!result?.ok) return { ok: false, reason: result?.reason || 'error' };
  return {
    ok: true,
    polygons: result.rings.map((ring) => ({ type: 'Polygon', coordinates: [ring.map(([x, y]) => [x / pxPerUnit, y / pxPerUnit])] })),
  };
}

// --- Teaching a tag shape ------------------------------------------------------

/**
 * The outline of what the user boxed (page units): the biggest closed path of
 * the drawing inside the box, else the outline of the ink inside it, else the
 * box itself. Resolves to { ok:true, ring, source } or { ok:false, reason }.
 */
export async function outlineInBox({ box, pageSize, pdfPage = null, pageCanvas = null }) {
  if (!box || !(box.width > 2 && box.height > 2)) return { ok: false, reason: 'too-small' };
  const shapes = pdfPage ? await getPageVectorShapes(pdfPage) : null;
  if (shapes?.length) {
    const slack = 2;
    const inBox = shapes.filter((v) => v.minX >= box.x - slack && v.maxX <= box.x + box.width + slack
      && v.minY >= box.y - slack && v.maxY <= box.y + box.height + slack
      && (v.maxX - v.minX) * (v.maxY - v.minY) >= 0.3 * box.width * box.height)
      .sort((a, b) => b.area - a.area);
    if (inBox.length) return { ok: true, ring: inBox[0].ring, source: 'vector' };
  }
  const crop = (await renderCropFromPdf({ point: null, pageSize, pdfPage, box }))
    || cropAroundTap({ point: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, pageSize, pageCanvas });
  if (!crop) return { ok: true, ring: [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]], source: 'box' };
  // A screen-canvas crop is a window round the box's middle: cut the box out.
  const bx0 = Math.max(0, Math.round((box.x - crop.toPage([0, 0])[0]) * crop.pxPerUnit));
  const by0 = Math.max(0, Math.round((box.y - crop.toPage([0, 0])[1]) * crop.pxPerUnit));
  const bw = Math.min(crop.width - bx0, Math.round(box.width * crop.pxPerUnit));
  const bh = Math.min(crop.height - by0, Math.round(box.height * crop.pxPerUnit));
  const full = adaptiveInkMaskFromRgba(crop.rgba, crop.width, crop.height);
  const mask = new Uint8Array(Math.max(1, bw * bh));
  for (let y = 0; y < bh; y += 1) mask.set(full.subarray((by0 + y) * crop.width + bx0, (by0 + y) * crop.width + bx0 + bw), y * bw);
  const found = outlineFromBox(mask, bw, bh, traceOuterLoop);
  return { ok: true, ring: found.ring.map(([x, y]) => crop.toPage([x + bx0, y + by0])), source: found.kind === 'box' ? 'box' : 'pixels' };
}

export function registerSmartFillProvider({ onNoMatch } = {}) {
  return registerMarkerShapeProvider({
    id: 'smartFill',
    label: 'Smart fill (beta)',
    icon: 'smartFillDrop',
    onPagePointerDown: async (context) => {
      const result = await readSmartFillOutlineAsync(context);
      if (result.ok) return { polygons: result.polygons };
      if (result.reason !== 'aborted' && !context.signal?.aborted) onNoMatch?.(result.reason);
      return null;
    },
  });
}
