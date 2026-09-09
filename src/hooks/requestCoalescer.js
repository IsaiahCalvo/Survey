/**
 * requestCoalescer.js — in-flight request de-duplication for Supabase reads.
 *
 * When the app boots, several uncoordinated hook instances (e.g. multiple live
 * useDocuments / useTemplates / useSubscriptionLimits consumers) each fire the
 * SAME read within a few milliseconds of one another, producing a burst of
 * identical network round-trips (see KAL-251 / DB-sync audit #3). This helper
 * collapses those concurrent identical reads into ONE round-trip: the first
 * caller for a given key runs the fetcher and registers its in-flight promise;
 * any caller arriving while that promise is still pending receives the SAME
 * promise instead of issuing a second request.
 *
 * IMPORTANT — this is IN-FLIGHT-ONLY de-dup, NOT a value cache. The key is
 * removed the instant the promise settles, so a deliberate later read (a
 * post-mutation refetch, a window-focus/interval refresh) always issues a fresh
 * network request and can never be served a stale value. Callers that must
 * always hit the network simply do NOT route through coalesceRead (or pass a
 * bypass flag at their own layer).
 *
 * Keys MUST be namespaced and include every discriminator that changes the
 * query (table + user id + projection/filter), e.g. `documents:<userId>:<projectId>`,
 * so two differently-shaped reads never share a promise and two different users
 * never cross.
 *
 * Pure module — no React, no Supabase imports — so it is unit-testable in
 * isolation and safe to import from any layer.
 */

const inFlight = new Map();
// Keep opt-in leases separate: existing consumers rely on exact shared Promise
// identity and must not inherit another consumer's cancellation policy.
const cancellable = new Map();
const canceled = () => Object.assign(new Error('The library read was canceled.'), {
  name: 'AbortError', code: 'LIBRARY_READ_ABORTED',
});

function cancellableRead(key, fetcher, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || typeof fetcher !== 'function') {
    return Promise.reject(new TypeError('Invalid coalesced read options'));
  }
  const { signal } = options;
  if (signal != null && (typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
    || typeof signal.removeEventListener !== 'function')) return Promise.reject(new TypeError('Invalid read abort signal'));
  if (signal?.aborted) return Promise.reject(canceled());

  let entry = cancellable.get(key);
  const start = !entry;
  if (!entry) {
    entry = { controller: new AbortController(), waiters: new Set(), settled: false };
    cancellable.set(key, entry);
  }
  const evict = () => { if (cancellable.get(key) === entry) cancellable.delete(key); };
  const waiter = new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok, value) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      entry.waiters.delete(deliver);
      if (!entry.settled && entry.waiters.size === 0) {
        // Evict before abort: a synchronous transport abort handler may start
        // a fresh request for this key. Old settlement must not evict it.
        entry.settled = true; evict(); entry.controller.abort();
      }
      if (ok) resolve(value); else reject(value);
    };
    const onAbort = () => finish(false, canceled());
    const deliver = (ok, value) => signal?.aborted ? onAbort() : finish(ok, value);
    entry.waiters.add(deliver);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });

  if (start && !entry.settled) {
    const settle = (ok, value) => {
      if (entry.settled) return;
      entry.settled = true; evict();
      for (const deliver of [...entry.waiters]) deliver(ok, value);
    };
    // Register the entry AND first subscriber before invoking the fetcher.
    // Reentrant callers can therefore join instead of starting a second read.
    let operation;
    try { operation = fetcher(entry.controller.signal); }
    catch (error) { settle(false, error); return waiter; }
    // Both outcomes are handled even after all waiters leave. A late rejected
    // transport must not create an unhandled rejection or poison a new entry.
    Promise.resolve(operation).then(value => settle(true, value), error => settle(false, error));
  }
  return waiter;
}

/**
 * Return the in-flight promise for `key` if one exists, otherwise run `fetcher`,
 * register its promise under `key`, and return it. The key is deleted as soon as
 * the promise settles (resolve OR reject).
 *
 * @template T
 * @param {string} key - namespaced de-dup key (table + identity + filters)
 * @param {(signal?: AbortSignal) => Promise<T>} fetcher - called only on a miss
 * @param {{signal?: AbortSignal}} [options] - opt in to subscriber cancellation;
 * fetcher receives the shared signal, canceled only when the last waiter leaves
 * @returns {Promise<T>} exact shared promise for two-argument calls; independent
 * waiter for opt-in calls. Invalidation detaches either entry without canceling
 * existing consumers. No result cache, retry, or idle listeners.
 */
export function coalesceRead(key, fetcher, options) {
  if (options !== undefined) return cancellableRead(key, fetcher, options);
  const existing = inFlight.get(key);
  if (existing) return existing;

  let promise;
  try {
    promise = Promise.resolve(fetcher());
  } catch (err) {
    // Synchronous throw from fetcher — surface it without poisoning the map.
    return Promise.reject(err);
  }

  inFlight.set(key, promise);
  // Free the key once settled (resolve OR reject) so the NEXT call issues a
  // fresh request. Guard against clobbering a newer promise under the same key.
  // Use then(cleanup, cleanup) rather than finally() so the cleanup branch
  // SWALLOWS a rejection (returning undefined) and never produces its own
  // unhandled-rejection; the original `promise` is still returned to callers,
  // who attach their own handlers.
  const cleanup = () => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  };
  promise.then(cleanup, cleanup);
  return promise;
}

/** Drop any in-flight promise for `key` (e.g. on a mutation that invalidates it). */
export function invalidateCoalescedRead(key) {
  inFlight.delete(key);
  cancellable.delete(key);
}

/** Drop all in-flight promises (e.g. on sign-out / account switch). */
export function clearCoalescedReads() {
  inFlight.clear();
  cancellable.clear();
}
