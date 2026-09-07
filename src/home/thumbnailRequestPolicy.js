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
