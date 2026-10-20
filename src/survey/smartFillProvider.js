/**
 * smartFillProvider.js — the beta Smart fill provider (owner 2026-10-20).
 *
 * Registers with markerShapeProviders.js when the beta flag is on
 * (smartFillFlag.js). Reads the page as rendered (its <canvas>) in a window
 * around the tap and hands the pixels to smartFillEngine.js. Returns
 * { polygons } in page units, or null with `reason` reported through
 * onNoMatch so the page can say "No outline found".
 */
import { registerMarkerShapeProvider } from './markerShapeProviders.js';
import { adaptiveInkMaskFromRgba, findSimilarTags, findTagOutlineTolerant } from './smartFillEngine.js';

// Window around the tap, page units (1 = 1 PDF point; a tag is ~10-80 pt).
const WINDOW_PAGE_UNITS = 360;
// Pixel cap per side so one tap stays quick on a big zoom.
const MAX_WINDOW_PX = 1200;

// UX: a tap answers fast or not at all; past this the toast says so.
const TIME_LIMIT_MS = 2500;

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
export async function renderCropFromPdf({ point, pageSize, pdfPage, signal }) {
  if (!pdfPage || typeof pdfPage.getViewport !== 'function' || !pageSize?.width || typeof document === 'undefined') return null;
  const half = WINDOW_PAGE_UNITS / 2;
  const left = Math.max(0, point.x - half);
  const top = Math.max(0, point.y - half);
  const right = Math.min(pageSize.width, point.x + half);
  const bottom = Math.min(pageSize.height, point.y + half);
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
    const task = pdfPage.render({ canvasContext: ctx, viewport, transform: [1, 0, 0, 1, -left * k, -top * k], background: 'white' });
    const onAbort = () => task.cancel?.();
    signal?.addEventListener?.('abort', onAbort);
    try {
      await task.promise;
    } finally {
      signal?.removeEventListener?.('abort', onAbort);
    }
    const { data } = ctx.getImageData(0, 0, width, height);
    return {
      rgba: data,
      width,
      height,
      seedX: (point.x - left) * k,
      seedY: (point.y - top) * k,
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
  return toPolygons(findTagOutlineTolerant(mask, crop.width, crop.height, crop.seedX, crop.seedY), crop);
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

/** Off-thread run with a time limit; falls back to same-thread. */
export async function readSmartFillOutlineAsync(context) {
  const crop = (await renderCropFromPdf(context)) || cropAroundTap(context);
  if (context.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (!crop) return Promise.resolve({ ok: false, reason: 'not-ready' });
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (!w) {
    const mask = adaptiveInkMaskFromRgba(crop.rgba, crop.width, crop.height);
    return Promise.resolve(toPolygons(findTagOutlineTolerant(mask, crop.width, crop.height, crop.seedX, crop.seedY), crop));
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
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), TIME_LIMIT_MS);
    w.addEventListener('message', onMessage);
    context.signal?.addEventListener?.('abort', onAbort);
    const buffer = crop.rgba.buffer.slice(0);
    w.postMessage({ id, rgba: buffer, width: crop.width, height: crop.height, seedX: crop.seedX, seedY: crop.seedY }, [buffer]);
  });
}

// The whole page at most this many px on its long side for a scan.
const MAX_SCAN_PX = 2400;
const SCAN_TIME_LIMIT_MS = 15000;

function postToWorker(message, transfer, signal, limitMs) {
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (!w) return null;
  const id = nextId++;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(value);
    };
    const onMessage = (event) => { if (event.data?.id === id) finish(event.data.result); };
    const onAbort = () => finish({ ok: false, reason: 'aborted' });
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), limitMs);
    w.addEventListener('message', onMessage);
    signal?.addEventListener?.('abort', onAbort);
    w.postMessage({ ...message, id }, transfer);
  });
}

/**
 * Find the tags on a page that match a saved sample (page units). Resolves to
 * { ok:true, polygons: [GeoJSON Polygon, ...] } or { ok:false, reason }.
 */
export async function findSimilarOnPage({ pageCanvas, pageSize, sample, signal = null }) {
  if (!pageCanvas || !pageSize?.width || !pageCanvas.width || !sample?.width) return { ok: false, reason: 'not-ready' };
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
  const pxSample = { ...sample, width: sample.width * pxPerUnit, height: sample.height * pxPerUnit };
  const buffer = data.buffer;
  const pending = postToWorker({ kind: 'scan', rgba: buffer, width, height, sample: pxSample }, [buffer], signal, SCAN_TIME_LIMIT_MS);
  const result = pending
    ? await pending
    : { ok: true, rings: findSimilarTags(adaptiveInkMaskFromRgba(data, width, height), width, height, pxSample) };
  if (!result?.ok) return { ok: false, reason: result?.reason || 'error' };
  return {
    ok: true,
    polygons: result.rings.map((ring) => ({ type: 'Polygon', coordinates: [ring.map(([x, y]) => [x / pxPerUnit, y / pxPerUnit])] })),
  };
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
