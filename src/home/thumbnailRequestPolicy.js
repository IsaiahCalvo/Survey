/** Rows can render bytes already on the device, but must not fetch a PDF. */
export function canResolveThumbnailBytes(doc, priority = false) {
  return Boolean(priority || doc?.file || /^(data:|blob:)/i.test(doc?.dataUrl || ''));
}

/** Share work only among requests with the same policy. A cache-only row must
 * not suppress a selected preview, and an unmounted caller must not cancel
 * work that another mounted caller still needs. */
export function createThumbnailRequestPool() {
  const requests = new Map();
  return {
    run(key, isCancelled, work) {
      const requestKey = key || Symbol('uncached-thumbnail');
      const existing = requests.get(requestKey);
      if (existing) {
        existing.consumers.add(isCancelled);
        return existing.promise;
      }
      const consumers = new Set([isCancelled]);
      const hasActiveConsumer = () => [...consumers].some(cancelled => !cancelled());
      const promise = Promise.resolve().then(() => work(hasActiveConsumer));
      requests.set(requestKey, { consumers, promise });
      void promise.then(
        () => requests.delete(requestKey),
        () => requests.delete(requestKey),
      );
      return promise;
    },
  };
}

/* Row → backfill hand-off (2026-09-23). A row that finds no cached image
 * still never downloads anything itself; it only tells the one idle backfill
 * queue (services/thumbnailBackfill.js, started by the Documents list) that a
 * VISIBLE row is waiting, so that document is done next. No queue running
 * (e.g. the Archive screen) → a no-op, exactly the pre-backfill behaviour. */
let activeBackfill = null;
export function registerThumbnailBackfill(backfill) {
  activeBackfill = backfill || null;
  return () => { if (activeBackfill === backfill) activeBackfill = null; };
}
export function requestThumbnailBackfill(doc) {
  if (!doc?.id || !activeBackfill) return false;
  activeBackfill.prioritize(doc);
  return true;
}

export { subscribeThumbnailUpdates } from '../services/thumbnailEvents.js';
