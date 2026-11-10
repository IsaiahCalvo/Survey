// Main-thread side of workers/pageThumbWorker.js: page previews drawn on
// their own thread from a copy of the file's bytes. One request at a time (the
// caller picks the next page each time, nearest the reader first).

// A worker holds its own copy of the file and its parsed pages: computers
// with cores to spare only (phones and tablets keep drawing previews on the
// viewer's own document), and files up to this size.
export const PAGE_THUMB_WORKER_MAX_BYTES = 200 * 1024 * 1024;

export function pageThumbWorkerSupported(env = globalThis) {
  if (typeof env.Worker !== 'function' || typeof env.OffscreenCanvas !== 'function') return false;
  if (typeof env.createImageBitmap !== 'function') return false;
  const cores = Number(env.navigator?.hardwareConcurrency) || 2;
  let touch = false;
  try { touch = Boolean(env.matchMedia?.('(pointer: coarse)')?.matches); } catch { touch = false; }
  return cores >= 4 && !touch;
}

/**
 * Opens a preview worker on `bytes` (transferred: pass a copy). Resolves a
 * renderer, or null when the worker cannot open the file.
 *   renderer.render(pageNumber, scale, rotation) → { bitmap, blob } | null
 *   renderer.destroy()
 */
export function openPageThumbRenderer(bytes, { workerSrc, options = {}, createWorker } = {}) {
  let worker;
  try {
    worker = createWorker
      ? createWorker()
      : new Worker(new URL('../workers/pageThumbWorker.js', import.meta.url), { type: 'module' });
  } catch {
    return Promise.resolve(null);
  }
  let seq = 0;
  let destroyed = false;
  const waiting = new Map();
  let opened = null;
  const settleAll = () => {
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    settleAll();
    try { worker.postMessage({ type: 'close' }); } catch { /* gone */ }
    // Let pdf.js close its document, then end the thread.
    setTimeout(() => { try { worker.terminate(); } catch { /* gone */ } }, 200);
  };
  return new Promise((resolve) => {
    opened = resolve;
    worker.onerror = () => {
      opened?.(null);
      opened = null;
      destroy();
    };
    worker.onmessage = ({ data }) => {
      const message = data || {};
      if (message.type === 'opened') {
        opened?.({
          numPages: message.numPages,
          render(pageNumber, scale, rotation = 0) {
            if (destroyed) return Promise.resolve(null);
            const id = ++seq;
            return new Promise((done) => {
              waiting.set(id, done);
              worker.postMessage({ type: 'thumb', id, pageNumber, scale, rotation });
            });
          },
          destroy,
        });
        opened = null;
      } else if (message.type === 'open-failed') {
        opened?.(null);
        opened = null;
        destroy();
      } else if (message.type === 'thumb' || message.type === 'thumb-failed') {
        const done = waiting.get(message.id);
        waiting.delete(message.id);
        if (!done) {
          try { message.bitmap?.close?.(); } catch { /* noop */ }
          return;
        }
        done(message.type === 'thumb' && message.bitmap ? { bitmap: message.bitmap, blob: message.blob || null } : null);
      }
    };
    try {
      worker.postMessage({ type: 'open', bytes, workerSrc, options }, bytes?.buffer ? [bytes.buffer] : []);
    } catch {
      opened?.(null);
      opened = null;
      destroy();
    }
  });
}
