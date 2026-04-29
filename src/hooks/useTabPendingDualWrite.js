// src/hooks/useTabPendingDualWrite.js
//
// Phase 30 — Per-document subscriber to the dual-write retry queue.
//
// CONTEXT.md `<decisions>` "Document tile signal":
//   When a document has a stuck queue, the document list / sidebar tile
//   shows a small "unsaved changes" icon BEFORE the user opens the
//   document, so they know to check it. Combines with the in-doc banner
//   once they open it.
//
// CONTEXT.md AC-13 (per-document, per-user signal): the queue is local
// (CONTEXT.md `<discretion>` confirmed by Plan 30-05), and Plan 30-07
// filters by documentId so each tab pill renders independently —
// drawing in 3 different documents and having a stuck queue on only 1
// of them shows the dot on only that 1 tab.
//
// Pattern reference: useDualWriteQueue (Plan 30-05) — same 1Hz polling
// tick with cheap shallow-equal setState gate. This hook is a per-
// document slice of that broader subscription.
//
// Negative-quarantined filter: quarantined entries do NOT count toward
// "pending" (Pitfall 30-5: rest of queue keeps moving past quarantined
// items; the tab dot only signals entries that are still actively
// retrying).

import { useEffect, useState } from 'react';
import { readQueue } from '../lib/collab/crdtDualWriteQueue.js';
import { getAuthSnapshot } from '../supabaseClient.js';

// UX: 1s polling tick matches Plan 30-05's useDualWriteQueue cadence so
// the tab dot lights up within 1s of an entry being enqueued, AND clears
// within 1s of the queue draining. Cost is one localStorage read +
// JSON.parse per tick — negligible.
const POLL_INTERVAL_MS = 1_000;

/**
 * Subscribe to the dual-write retry queue for a single documentId.
 *
 * Returns true iff the queue has at least one non-quarantined entry whose
 * payload.opts.documentId === documentId. The hook scopes its subscription
 * to one documentId so each tab pill renders independently.
 *
 * @param {string|null|undefined} documentId
 * @returns {boolean}
 */
export function useTabPendingDualWrite(documentId) {
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    if (!documentId) {
      // No documentId — return false (default empty-queue path).
      setHasPending(false);
      return undefined;
    }

    let cancelled = false;

    async function tick() {
      // Resolve userId from the cached Supabase auth session. getAuthSnapshot
      // is async (Promise<{ sessionUserId, ... }>); falls back to no-op when
      // unauthenticated. The cost is one call per tick — Supabase caches the
      // session locally so this is a synchronous-feel read in practice.
      let userId = null;
      try {
        const auth = await getAuthSnapshot();
        userId = auth?.sessionUserId ?? null;
      } catch (_e) {
        userId = null;
      }
      if (cancelled) return;

      if (!userId) {
        setHasPending((prev) => (prev === false ? prev : false));
        return;
      }

      const queue = readQueue(userId) || {};
      const annoIds = Object.keys(queue);
      // Default-empty path: when the queue has no entries at all, the tab
      // dot is dark (annoIds.length > 0 is the gate for the per-entry walk).
      let pending = false;
      if (annoIds.length > 0) {
        for (const annoId of annoIds) {
          const entry = queue[annoId];
          if (!entry) continue;
          // Negative-quarantined filter: quarantined entries do NOT count
          // toward "pending" — Pitfall 30-5 (rest of queue keeps moving past
          // quarantined items; the tab dot signals only entries that are
          // still actively retrying, not permanently-failed ones).
          //
          // Read as: keep entries where !entry.quarantined is true; skip
          // entries where entry.quarantined === true.
          const isLive = !entry.quarantined;
          if (!isLive) continue;
          // Per-document filter: payload.opts.documentId is the canonical
          // shape Plan 30-04's enqueueDualWrite uses for both commit
          // ({ fabricObj, opts }) and delete
          // ({ op: 'delete', documentId, annoId, opts }) payloads. Fall back
          // to entry.payload.documentId for the delete-shape and
          // entry.documentId for any legacy entries.
          const entryDocId =
            entry.payload?.opts?.documentId
            ?? entry.payload?.documentId
            ?? entry.documentId
            ?? null;
          if (entryDocId === documentId) {
            pending = true;
            break;
          }
        }
      }
      if (cancelled) return;
      // Cheap setState gate: only update when the boolean changes so the
      // consumer (TabBar tab item) doesn't re-render every 1s tick.
      setHasPending((prev) => (prev === pending ? prev : pending));
    }

    // Run immediately so the first paint reflects the current queue state.
    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [documentId]);

  return hasPending;
}

export default useTabPendingDualWrite;
