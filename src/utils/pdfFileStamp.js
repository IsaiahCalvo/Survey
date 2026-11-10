// The SHA-256 of an open file's bytes, per pdf.js base document. The page
// preview session (utils/pagePreviewSession.js) computes it for every open
// file; other per-file device caches (utils/searchTextKeep.js) reuse it
// instead of hashing the file again.
const stamps = new WeakMap();
const waiters = new WeakMap();

export function setPdfFileStamp(base, stampPromise) {
  if (!base || typeof base !== 'object' || !stampPromise) return;
  stamps.set(base, stampPromise);
  const waiting = waiters.get(base);
  if (waiting) {
    waiters.delete(base);
    for (const resolve of waiting) resolve(stampPromise);
  }
}

/**
 * The stamp of `base`'s bytes, or null when none is known within `waitMs`
 * (no session yet, or the file is still downloading).
 */
export function pdfFileStamp(base, { waitMs = 0 } = {}) {
  if (!base || typeof base !== 'object') return Promise.resolve(null);
  const known = stamps.get(base);
  const stamp = known || (waitMs > 0
    ? new Promise((resolve) => {
      const list = waiters.get(base) || [];
      list.push(resolve);
      waiters.set(base, list);
    })
    : null);
  if (!stamp) return Promise.resolve(null);
  const settled = Promise.resolve(stamp).then((value) => value || null, () => null);
  if (!(waitMs > 0)) return known ? settled : Promise.resolve(null);
  return Promise.race([settled, new Promise((resolve) => setTimeout(() => resolve(null), waitMs))]);
}
