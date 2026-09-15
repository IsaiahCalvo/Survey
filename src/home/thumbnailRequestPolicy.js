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
    run(key, isCancelled, work, signal = null) {
      const requestKey = key || Symbol('uncached-thumbnail');
      const existing = requests.get(requestKey);
      if (existing) {
        existing.addConsumer(isCancelled, signal);
        return existing.promise;
      }
      const controller = new AbortController();
      const consumers = new Set();
      const hasActiveConsumer = () => [...consumers]
        .some(consumer => !consumer.cancelled() && !consumer.signal?.aborted);
      const addConsumer = (cancelled, consumerSignal) => {
        const consumer = { cancelled, signal: consumerSignal, onAbort: null };
        consumer.onAbort = () => { if (!hasActiveConsumer()) controller.abort(); };
        consumers.add(consumer);
        consumerSignal?.addEventListener('abort', consumer.onAbort, { once: true });
        if (consumerSignal?.aborted) consumer.onAbort();
      };
      addConsumer(isCancelled, signal);
      const promise = Promise.resolve().then(() => work(hasActiveConsumer, controller.signal));
      requests.set(requestKey, { consumers, promise, addConsumer });
      const cleanup = () => {
        for (const consumer of consumers) consumer.signal?.removeEventListener('abort', consumer.onAbort);
        requests.delete(requestKey);
      };
      void promise.then(
        cleanup,
        cleanup,
      );
      return promise;
    },
  };
}
