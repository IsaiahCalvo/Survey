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
import { adaptiveInkMaskFromRgba, findTagOutlineTolerant } from './smartFillEngine.js';

// Window around the tap, page units (1 = 1 PDF point; a tag is ~10-80 pt).
const WINDOW_PAGE_UNITS = 360;
// Pixel cap per side so one tap stays quick on a big zoom.
const MAX_WINDOW_PX = 1200;

// UX: a tap answers fast or not at all; past this the toast says so.
const TIME_LIMIT_MS = 2500;

/** Crop the rendered page around the tap. Returns pixels + the mapping back. */
export function cropAroundTap({ point, pageSize, pageCanvas }) {
  if (!pageCanvas || !pageSize?.width || !pageCanvas.width) return null;
  // Undrawn <canvas> is 300×150 until pdf.js blits a bitmap. Aspect alone
  // misses 2:1 plot sheets (36×18, 24×12), which match that default ratio.
  if (pageCanvas.width === 300 && pageCanvas.height === 150) return null;
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
function onWorkerError() {
  workerBroken = true;
  worker = null;
}

function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('./smartFillWorker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('error', onWorkerError);
  } catch {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function discardWorker(w) {
  if (worker !== w) return;
  worker = null;
  try { w.removeEventListener('error', onWorkerError); } catch { /* already gone */ }
  try { w.terminate(); } catch { /* already gone */ }
}

/** Off-thread run with a time limit; falls back to same-thread. */
export function readSmartFillOutlineAsync(context) {
  const crop = cropAroundTap(context);
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
      // Drop the shared worker so a timed-out or aborted job cannot occupy
      // the queue while the next tap's 2.5s limit is already running.
      if (value?.reason === 'timeout' || value?.reason === 'aborted') discardWorker(w);
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
