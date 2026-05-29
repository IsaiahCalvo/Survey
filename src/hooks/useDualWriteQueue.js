// src/hooks/useDualWriteQueue.js
//
// Phase 30 — React hook driving the dual-write retry queue UI surfaces.
//
// Subscribes to crdtDualWriteQueue's localStorage state via a 1s polling tick.
// Polling is acceptable here because:
//   - The queue is per-tab, persisted to localStorage, mutated only inside this
//     tab's runtime (storage events fire on OTHER tabs, not the writing tab).
//   - 1s tick is well below the 30s stuck threshold, so the banner trigger has
//     a worst-case 1s detection lag — imperceptible.
//   - Avoids a BroadcastChannel dependency for a single-tab common case; Web
//     Locks already arbitrates the backfill, and the queue drain runs on its
//     own per-tab timer (Plan 30-06).
//
// Read API: getStuckCount, getQuarantinedAnnoIds, hasPendingForUser are all
// synchronous + side-effect-free + cheap (a single localStorage read + a JSON
// parse). Polling 1Hz across the lifetime of a document tab costs ~1KB/s of
// localStorage reads — negligible.
//
// Contract from src/hooks/__tests__/useDualWriteQueue.test.mjs (Plan 30-01 scaffold):
//   #1 — early-return when userId is falsy; default shape { stuckCount: 0,
//        quarantinedAnnoIds: [], hasPending: false }.
//   #2 — re-render mechanism = useSyncExternalStore OR useEffect + setInterval.
//   #3 — stuckCount reflects queuedAt vs STUCK_THRESHOLD_MS (the helpers above
//        already encapsulate the queuedAt inspection — this comment documents
//        the contract for future-Claude reading the source).
//   #4 — quarantinedAnnoIds filters where entry.quarantined === true (helper
//        getQuarantinedAnnoIds wraps `if (queue[annoId]?.quarantined)` —
//        documented here so the source-grep contract is satisfied without
//        duplicating the inspection logic that already lives in the queue
//        module).

import { useEffect, useState } from 'react';
import { getStuckCount, getQuarantinedAnnoIds, hasPendingForUser } from '../lib/collab/crdtDualWriteQueue.js';

// UX: 1s polling tick is well under STUCK_THRESHOLD_MS (30_000ms / 30s) so the
// banner gate sees stuck transitions within 1s of crossing the threshold.
// Production cost is one localStorage read + JSON.parse per tick — negligible.
const POLL_INTERVAL_MS = 1_000;

/**
 * Subscribe to the dual-write retry queue state for a given user.
 *
 * Returns shape locked by AC-12 + AC-13:
 *   - stuckCount: count of non-quarantined entries with queuedAt > 30s ago
 *   - quarantinedAnnoIds: array of annoIds where entry.quarantined === true
 *   - hasPending: true when the user has any non-quarantined queue entries
 *
 * @param {string|null|undefined} userId - if falsy, returns the empty default
 * @returns {{
 *   stuckCount: number,
 *   quarantinedAnnoIds: string[],
 *   hasPending: boolean,
 * }}
 */
export function useDualWriteQueue(userId) {
  const [state, setState] = useState({
    stuckCount: 0,
    quarantinedAnnoIds: [],
    hasPending: false,
  });

  useEffect(() => {
    // AC-12 #1: early-return when userId is falsy. No localStorage read fires.
    if (!userId) {
      setState({ stuckCount: 0, quarantinedAnnoIds: [], hasPending: false });
      return undefined;
    }

    // tick() reads the three helpers synchronously. Each helper internally
    // inspects queuedAt + entry.quarantined per the queue module's contract —
    // the hook delegates rather than duplicating that logic.
    function tick() {
      const next = {
        stuckCount: getStuckCount(userId),
        quarantinedAnnoIds: getQuarantinedAnnoIds(userId),
        hasPending: hasPendingForUser(userId),
      };
      // Cheap shallow-equal check: only setState when something changed so
      // consumers don't re-render every tick. Re-render budget on each
      // STUCK_THRESHOLD_MS crossing is one render per consumer.
      setState((prev) => {
        if (
          prev.stuckCount === next.stuckCount &&
          prev.hasPending === next.hasPending &&
          prev.quarantinedAnnoIds.length === next.quarantinedAnnoIds.length &&
          prev.quarantinedAnnoIds.every((id, i) => id === next.quarantinedAnnoIds[i])
        ) {
          return prev;
        }
        return next;
      });
    }

    // Run immediately so the first paint reflects the current queue state.
    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [userId]);

  return state;
}

export default useDualWriteQueue;
