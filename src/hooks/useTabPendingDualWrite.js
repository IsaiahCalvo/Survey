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
import { getAuthSnapshot, supabase } from '../supabaseClient.js';

// UX: 1s polling tick matches Plan 30-05's useDualWriteQueue cadence so
// the tab dot lights up within 1s of an entry being enqueued, AND clears
// within 1s of the queue draining. Cost is one localStorage read +
// JSON.parse per tick — negligible.
const POLL_INTERVAL_MS = 1_000;
const AUTH_RETRY_INTERVAL_MS = 10_000;

function isTabHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * Resolve the signed-in user id once and keep it updated via Supabase auth
 * events instead of calling `getAuthSnapshot()` (which acquires the GoTrue
 * storage lock) every second forever.
 */
function createAuthUserIdTracker() {
  let cachedUserId = undefined;
  let lastResolveAttemptAt = 0;

  async function resolveUserId() {
    if (cachedUserId !== undefined) {
      if (cachedUserId !== null || Date.now() - lastResolveAttemptAt < AUTH_RETRY_INTERVAL_MS) {
        return cachedUserId;
      }
    }
    lastResolveAttemptAt = Date.now();
    try {
      const auth = await getAuthSnapshot();
      cachedUserId = auth?.sessionUserId ?? null;
    } catch (_e) {
      cachedUserId = null;
    }
    return cachedUserId;
  }

  let authSub = null;
  try {
    const res = supabase?.auth?.onAuthStateChange?.((_event, session) => {
      cachedUserId = session?.user?.id ?? null;
    });
    authSub = res?.data?.subscription ?? null;
  } catch (_e) {
    authSub = null;
  }

  return {
    resolveUserId,
    dispose() {
      try { authSub?.unsubscribe?.(); } catch (_e) { /* best effort */ }
    },
  };
}

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
/**
 * Hook variant that returns the FULL set of documentIds with at least one
 * non-quarantined entry in the dual-write queue. Used by TabBar where calling
 * a per-tab hook inside .map() violated React's rules-of-hooks (the hook
 * count changed when a tab was closed, causing a "Rendered fewer hooks than
 * expected" crash). The TabBar calls this once at the top and consults the
 * Set per tab in the render loop — no hook calls inside .map().
 *
 * @returns {Set<string>}
 */
export function useDocsPendingDualWrite() {
  const [pendingDocIds, setPendingDocIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const authTracker = createAuthUserIdTracker();

    async function tick(force = false) {
      if (!force && isTabHidden()) return;
      const userId = await authTracker.resolveUserId();
      if (cancelled) return;

      const next = new Set();
      if (userId) {
        const queue = readQueue(userId) || {};
        for (const annoId of Object.keys(queue)) {
          const entry = queue[annoId];
          if (!entry || entry.quarantined) continue;
          const docId =
            entry.payload?.opts?.documentId
            ?? entry.payload?.documentId
            ?? entry.documentId
            ?? null;
          if (docId) next.add(docId);
        }
      }
      if (cancelled) return;
      setPendingDocIds((prev) => {
        if (prev.size === next.size) {
          let same = true;
          for (const id of next) { if (!prev.has(id)) { same = false; break; } }
          if (same) return prev;
        }
        return next;
      });
    }

    const onVisibilityChange = () => {
      if (!isTabHidden()) void tick(true);
    };

    void tick(true);
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      cancelled = true;
      clearInterval(handle);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      authTracker.dispose();
    };
  }, []);

  return pendingDocIds;
}

export function useTabPendingDualWrite(documentId) {
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    if (!documentId) {
      // No documentId — return false (default empty-queue path).
      setHasPending(false);
      return undefined;
    }

    let cancelled = false;
    const authTracker = createAuthUserIdTracker();

    async function tick(force = false) {
      if (!force && isTabHidden()) return;
      const userId = await authTracker.resolveUserId();
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

    const onVisibilityChange = () => {
      if (!isTabHidden()) void tick(true);
    };

    // Run immediately so the first paint reflects the current queue state.
    void tick(true);
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      cancelled = true;
      clearInterval(handle);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      authTracker.dispose();
    };
  }, [documentId]);

  return hasPending;
}
