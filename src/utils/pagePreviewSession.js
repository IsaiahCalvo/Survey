// Page previews for one open file: kept on the device (services/pageThumbStore.js)
// and drawn on their own thread (utils/pageThumbRenderer.js), 2026-11-09.
//
// The viewer keeps its previews in memory (PdfjsViewerContainer PAGE_THUMBS)
// and shows one as soon as a page mounts, until the page's sharp draw lands.
// A session per open file:
//   1. gets the file's bytes (at once for a file opened from bytes; after the
//      download for a streamed one) and their SHA-256;
//   2. loads the previews kept for those bytes, so a reopened file shows every
//      page at once;
//   3. draws the missing ones on the preview worker, nearest the reader first;
//   4. keeps every new preview (worker or viewer-drawn) for the next open.
import { pageThumbStamp, pageThumbStore } from '../services/pageThumbStore.js';
import { openPageThumbRenderer, PAGE_THUMB_WORKER_MAX_BYTES } from './pageThumbRenderer.js';

// A streamed file must be all here within this long for the session.
export const PAGE_PREVIEW_BYTES_WAIT_MS = 30_000;
const SAVE_BATCH_DELAY_MS = 1500;

const idle = (fn) => {
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 50);
};

async function fileBytes(base, source, { waitMs, isStopped }) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (typeof base?.getData !== 'function') return null;
  // getData() before the whole file is here would ask for every missing chunk
  // at once (services/cloudPdfStream.js): wait for the download.
  if (typeof base.getDownloadInfo === 'function') {
    const here = await Promise.race([
      base.getDownloadInfo().then((info) => !(info?.length > PAGE_THUMB_WORKER_MAX_BYTES), () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), waitMs)),
    ]);
    if (!here || isStopped()) return null;
  }
  try { return await base.getData(); } catch { return null; }
}

function canvasBlob(canvas) {
  return new Promise((resolve) => {
    try {
      if (typeof canvas?.convertToBlob === 'function') {
        canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }).then(resolve, () => resolve(null));
      } else if (typeof canvas?.toBlob === 'function') {
        canvas.toBlob((blob) => resolve(blob || null), 'image/webp', 0.8);
      } else resolve(null);
    } catch { resolve(null); }
  });
}

/**
 * Starts a session for `base` (the pdf.js document of the file's own bytes).
 *   source       the bytes the viewer opened, when it opened bytes
 *   useWorker    draw missing previews on the preview worker
 *   workerSrc / assetOptions   pdf.js worker URL and getDocument asset options
 */
export function createPagePreviewSession(base, {
  source = null,
  useWorker = false,
  workerSrc,
  assetOptions = {},
  store = pageThumbStore(),
  waitMs = PAGE_PREVIEW_BYTES_WAIT_MS,
  openRenderer = openPageThumbRenderer,
  stamp: givenStamp,
} = {}) {
  let stopped = false;
  const isStopped = () => stopped;
  const saved = new Set(); // pageKeys kept (or being kept) for this file
  let pending = [];
  let saveTimer = 0;

  const bytesPromise = givenStamp ? Promise.resolve(null) : fileBytes(base, source, { waitMs, isStopped });
  const stampPromise = givenStamp
    ? Promise.resolve(givenStamp)
    : bytesPromise.then((bytes) => (bytes && !stopped ? pageThumbStamp(bytes) : null));
  const keptPromise = stampPromise.then(async (stamp) => {
    if (!stamp || stopped || store.isDisabled) return [];
    const rows = await store.loadDoc(stamp);
    for (const row of rows) saved.add(row.pageKey);
    return rows;
  });
  let rendererReleased = false;
  // Opened on first ask: a reopened file whose previews are all kept never
  // starts the worker.
  let rendererPromise = null;
  const openRendererOnce = () => {
    if (!rendererPromise) {
      rendererPromise = useWorker
        ? bytesPromise.then((bytes) => {
          if (!bytes || stopped || rendererReleased || typeof bytes.slice !== 'function') return null;
          // A copy: the worker takes ownership of what it is sent.
          return openRenderer(bytes.slice(0), { workerSrc, options: assetOptions });
        }).then((renderer) => {
          if (renderer && (stopped || rendererReleased)) { renderer.destroy(); return null; }
          return renderer;
        }, () => null)
        : Promise.resolve(null);
    }
    return rendererPromise;
  };

  const flush = async (final = false) => {
    saveTimer = 0;
    const batch = pending;
    pending = [];
    const halted = () => stopped && !final;
    const stamp = await stampPromise;
    if (!stamp || halted() || !batch.length) return;
    const rows = [];
    for (const item of batch) {
      const blob = item.blob || await canvasBlob(item.canvas);
      if (!blob || halted()) continue;
      try {
        rows.push({ pageKey: item.pageKey, scale: item.scale, type: blob.type || 'image/png', data: await blob.arrayBuffer() });
      } catch { /* skip this one */ }
    }
    if (rows.length && !halted()) await store.putPages(stamp, rows);
  };

  return {
    /** Previews kept on the device for this file: [{ pageKey, scale, type, data }]. */
    kept: () => keptPromise,
    /** The preview worker, or null (none, or it could not open the file). */
    renderer: () => (rendererReleased ? Promise.resolve(null) : openRendererOnce()),
    /** Ends the preview worker (every preview drawn): frees its copy of the file. */
    releaseRenderer() {
      if (rendererReleased) return;
      rendererReleased = true;
      rendererPromise?.then((renderer) => renderer?.destroy(), () => {});
    },
    stamp: () => stampPromise,
    /**
     * Keep a new preview for the next open: from the worker (`blob`) or a
     * canvas the viewer drew (encoded in idle time).
     */
    keep(pageKey, { canvas = null, blob = null, scale } = {}) {
      if (stopped || !pageKey || saved.has(pageKey) || store.isDisabled) return;
      saved.add(pageKey);
      // The canvas may be reused by the viewer: copy what is needed now.
      let copy = null;
      if (!blob && canvas?.width) {
        try {
          copy = document.createElement('canvas');
          copy.width = canvas.width;
          copy.height = canvas.height;
          copy.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0);
        } catch { copy = null; }
        if (!copy) { saved.delete(pageKey); return; }
      }
      pending.push({ pageKey, blob, canvas: copy, scale });
      if (!saveTimer) saveTimer = setTimeout(() => idle(() => { flush().catch(() => {}); }), SAVE_BATCH_DELAY_MS);
    },
    isKept: (pageKey) => saved.has(pageKey),
    stop() {
      if (stopped) return;
      // Previews still waiting are written first (best effort).
      if (pending.length) { clearTimeout(saveTimer); flush(true).catch(() => {}); }
      stopped = true;
      rendererPromise?.then((renderer) => renderer?.destroy(), () => {});
    },
    get stopped() { return stopped; },
  };
}

/** Decodes a kept preview row to an ImageBitmap (off the main thread). */
export async function decodeKeptPreview(row) {
  if (!row?.data || typeof globalThis.createImageBitmap !== 'function') return null;
  try {
    return await globalThis.createImageBitmap(new Blob([row.data], { type: row.type || 'image/webp' }));
  } catch {
    return null;
  }
}
