/**
 * pagesPanelThumbnailCache.js — what the Pages panel has already drawn, kept
 * for as long as the document itself is open.
 *
 * Owner 2026-10-01 (iPhone recording): Pages thumbnails went blank and showed
 * "Loading…" again every time the panel was reopened. The phone sheet unmounts
 * the panel when it closes, and the drawn images lived only in the panel's own
 * React state, so each reopen threw them away and redrew all of them. They now
 * live here, keyed by the pdf.js document object (a WeakMap, so closing the
 * document frees them), and a reopened panel starts with every image it drew.
 */

const store = new WeakMap();

export function getCachedPageThumbnails(doc) {
  if (!doc || typeof doc !== 'object') return null;
  return store.get(doc) || null;
}

export function rememberPageThumbnails(doc, thumbnails, ratios) {
  if (!doc || typeof doc !== 'object') return;
  store.set(doc, { thumbnails: thumbnails || {}, ratios: ratios || {} });
}

/**
 * Encode a canvas as a JPEG data URL without blocking the main thread where
 * the browser can help: canvas.toBlob encodes off the main thread and the
 * FileReader turns the bytes into a data URL asynchronously. toDataURL (the
 * old path) encoded synchronously and was the single biggest cost of a fast
 * scroll through the panel (profile, 2026-10-01). Falls back to toDataURL.
 *
 * Small images (the first low-res pass) still encode synchronously: that
 * costs a millisecond or two, while Chromium runs toBlob's encode in idle
 * time, which a busy moment (the sheet opening) can hold back by ~0.5s.
 */
export const SYNC_ENCODE_MAX_PIXELS = 60000;

export function encodeCanvasToDataUrl(canvas, type = 'image/jpeg', quality = 0.72) {
  if (!canvas) return Promise.resolve(null);
  const syncEncode = () => {
    try { return canvas.toDataURL(type, quality); } catch { return null; }
  };
  if ((canvas.width * canvas.height) <= SYNC_ENCODE_MAX_PIXELS
    || typeof canvas.toBlob !== 'function' || typeof FileReader !== 'function') {
    return Promise.resolve(syncEncode());
  }
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) { resolve(syncEncode()); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : syncEncode());
        reader.onerror = () => resolve(syncEncode());
        reader.readAsDataURL(blob);
      }, type, quality);
    } catch {
      resolve(syncEncode());
    }
  });
}

/**
 * Decode an image before it is shown, so swapping it in never paints an empty
 * box while the browser decodes (and the decode runs off the main thread where
 * the browser supports img.decode). Resolves either way.
 */
export function predecodeImage(src) {
  if (typeof src !== 'string' || !src || typeof Image !== 'function') return Promise.resolve();
  try {
    const img = new Image();
    img.src = src;
    if (typeof img.decode !== 'function') return Promise.resolve();
    return img.decode().catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/**
 * Take the next job from a LIFO queue, preferring a page that is on screen
 * right now over one only inside the preload margin.
 */
export function takePriorityJob(queue, isOnScreen) {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  if (typeof isOnScreen === 'function') {
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (isOnScreen(queue[index].pageNumber)) {
        return queue.splice(index, 1)[0];
      }
    }
  }
  return queue.pop();
}
