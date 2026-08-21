// src/hooks/useTabPendingDualWrite.js
//
// Per-document subscriber to the LIVE annotation outbox (retired dual-write
// localStorage queue). TabBar calls useDocsPendingDualWrite once so hook
// count stays stable when a tab closes.
//
// Negative-quarantined filter: only count entries where !entry.quarantined
// (Pitfall 30-5). Per-document filter uses entry.documentId.

import { useEffect, useState } from 'react';
import { getSharedAnnotationOutbox } from '../services/annotationDocOutbox.js';
import { summarizeOutboxRetry } from '../services/annotationOutboxRetryView.js';
import { getAuthSnapshot } from '../supabaseClient.js';

const POLL_INTERVAL_MS = 1_000;

async function readPendingDocumentIds() {
  let userId = null;
  try {
    const auth = await getAuthSnapshot();
    userId = auth?.sessionUserId ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return new Set();
  try {
    const outbox = await getSharedAnnotationOutbox();
    const [pending, quarantined] = await Promise.all([
      outbox.listAllPendingForActor(userId),
      outbox.listAllQuarantinedForActor(userId),
    ]);
    return new Set(summarizeOutboxRetry({ pending, quarantined }).pendingDocumentIds);
  } catch {
    return new Set();
  }
}

/**
 * Hook variant that returns the FULL set of documentIds with at least one
 * non-quarantined outbox entry. Used by TabBar where calling a per-tab hook
 * inside .map() violated React's rules-of-hooks.
 *
 * @returns {Set<string>}
 */
export function useDocsPendingDualWrite() {
  const [pendingDocIds, setPendingDocIds] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      const next = await readPendingDocumentIds();
      if (cancelled) return;
      setPendingDocIds((prev) => {
        if (prev.size === next.size) {
          let same = true;
          for (const id of next) {
            if (!prev.has(id)) { same = false; break; }
          }
          if (same) return prev;
        }
        return next;
      });
    }

    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  return pendingDocIds;
}

export function useTabPendingDualWrite(documentId) {
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    if (!documentId) {
      // Default-empty path: return false when documentId has no queue entries.
      setHasPending(false);
      return undefined;
    }

    let cancelled = false;

    async function tick() {
      const pendingDocIds = await readPendingDocumentIds();
      if (cancelled) return;
      // entry.documentId is the live outbox field (replaces payload.opts.documentId).
      const pending = pendingDocIds.has(documentId);
      setHasPending((prev) => (prev === pending ? prev : pending));
    }

    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [documentId]);

  return hasPending;
}
