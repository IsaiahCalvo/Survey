/**
 * Decoded-image cache for image marks (imported PDF stamp proxies) painted by
 * the Canvas2D annotation painter.
 *
 * w52 (2026-09-28) "annotations are annotations": the SVG layer paints a stamp
 * with <image href>, which the browser decodes on its own. Canvas2D can only
 * drawImage a DECODED image, and paintAnnotationCanvas is synchronous, so the
 * painter asks this cache: a decoded image draws at once; a missing one starts
 * decoding and the paint reports it as pending (paintAnnotationCanvas returns
 * pendingImageCount). Callers repaint when preloadAnnotationImages resolves
 * (the overlay and the worker) or await it before painting (thumbnails).
 *
 * Worker-safe: decodes with fetch + createImageBitmap (works for data: URLs on
 * the main thread and inside annotationCanvasWorker), falling back to an
 * <img> element on the main thread. Where neither exists (Node tests) images
 * resolve to null and the painter simply skips them.
 */
import { isPdfStampProxy } from './pdfStampProxy.js';

const MAX_CACHED_IMAGES = 48;
// src -> { image, promise }; insertion order doubles as LRU order.
const cache = new Map();

const defaultDecoder = async (src) => {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    try {
      const response = await fetch(src);
      return await createImageBitmap(await response.blob());
    } catch { /* fall through to <img> */ }
  }
  if (typeof Image === 'function') {
    const image = new Image();
    image.src = src;
    try {
      if (typeof image.decode === 'function') await image.decode();
      else await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      return image;
    } catch {
      return null;
    }
  }
  return null;
};

let decoder = defaultDecoder;

/** Test seam: swap the decoder (null restores the default) and empty the cache. */
export function setAnnotationImageDecoder(nextDecoder) {
  decoder = typeof nextDecoder === 'function' ? nextDecoder : defaultDecoder;
  cache.clear();
}

const touch = (src, entry) => {
  cache.delete(src);
  cache.set(src, entry);
  while (cache.size > MAX_CACHED_IMAGES) cache.delete(cache.keys().next().value);
};

/** Decode (once) and resolve to the drawable image, or null when it cannot be decoded. */
export function loadAnnotationImage(src) {
  if (typeof src !== 'string' || !src) return Promise.resolve(null);
  const existing = cache.get(src);
  if (existing) return existing.promise;
  const entry = { image: null, promise: null };
  entry.promise = Promise.resolve()
    .then(() => decoder(src))
    .then((image) => { entry.image = image || null; return entry.image; })
    .catch(() => null);
  touch(src, entry);
  return entry.promise;
}

/**
 * The decoded image for `src`, or null while it is still decoding (the decode
 * is started on the first ask).
 */
export function getAnnotationImage(src) {
  if (typeof src !== 'string' || !src) return null;
  const entry = cache.get(src);
  if (!entry) {
    loadAnnotationImage(src);
    return null;
  }
  return entry.image;
}

export const annotationImageSource = (object) => (
  isPdfStampProxy(object) ? (object.src || object.dataUrl) : null
);

/** Whether every image mark in `objects` is ready to draw. */
export function annotationImagesReady(objects) {
  for (const object of objects || []) {
    const src = annotationImageSource(object);
    if (src && !cache.get(src)?.image) return false;
  }
  return true;
}

/**
 * Decode every image mark in `objects`. Resolves true when at least one image
 * became drawable that was not before (the caller should repaint).
 */
export async function preloadAnnotationImages(objects) {
  const pending = [];
  for (const object of objects || []) {
    const src = annotationImageSource(object);
    if (!src || cache.get(src)?.image) continue;
    pending.push(loadAnnotationImage(src));
  }
  if (pending.length === 0) return false;
  const images = await Promise.all(pending);
  return images.some(Boolean);
}
