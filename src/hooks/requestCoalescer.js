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

/**
 * Return the in-flight promise for `key` if one exists, otherwise run `fetcher`,
 * register its promise under `key`, and return it. The key is deleted as soon as
 * the promise settles (resolve OR reject).
 *
 * @template T
 * @param {string} key - namespaced de-dup key (table + identity + filters)
 * @param {() => Promise<T>} fetcher - issues the actual request; only called on a miss
 * @returns {Promise<T>} the shared (or freshly-started) promise
 */
export function coalesceRead(key, fetcher) {
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
}

/** Drop all in-flight promises (e.g. on sign-out / account switch). */
export function clearCoalescedReads() {
  inFlight.clear();
}
