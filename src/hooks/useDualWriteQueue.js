// src/hooks/useDualWriteQueue.js
//
// Stuck-banner / quarantine subscription over the LIVE annotation outbox.
// Polls annotationDocOutbox at 1Hz. 1s tick is well below STUCK_THRESHOLD_MS
// (30_000). Helpers inspect queuedAt + entry.quarantined === true / terminal
// status inside summarizeOutboxRetry.

import { useEffect, useState } from 'react';
import { getSharedAnnotationOutbox } from '../services/annotationDocOutbox.js';
import {
  EMPTY_OUTBOX_RETRY,
  STUCK_THRESHOLD_MS,
  summarizeOutboxRetry,
} from '../services/annotationOutboxRetryView.js';

const POLL_INTERVAL_MS = 1_000;

/**
 * Subscribe to live outbox retry state for a given user.
 *
 * @param {string|null|undefined} userId - if falsy, returns the empty default
 */
export function useDualWriteQueue(userId) {
  const [state, setState] = useState({
    stuckCount: 0,
    quarantinedAnnoIds: [],
    hasPending: false,
  });

  useEffect(() => {
    if (!userId) {
      setState({ stuckCount: 0, quarantinedAnnoIds: [], hasPending: false });
      return undefined;
    }

    let cancelled = false;

    async function tick() {
      try {
        const outbox = await getSharedAnnotationOutbox();
        const [pending, quarantined] = await Promise.all([
          outbox.listAllPendingForActor(userId),
          outbox.listAllQuarantinedForActor(userId),
        ]);
        if (cancelled) return;
        const next = summarizeOutboxRetry({ pending, quarantined });
        setState((prev) => {
          if (
            prev.stuckCount === next.stuckCount &&
            prev.hasPending === next.hasPending &&
            prev.quarantinedAnnoIds.length === next.quarantinedAnnoIds.length &&
            prev.quarantinedAnnoIds.every((id, i) => id === next.quarantinedAnnoIds[i])
          ) {
            return prev;
          }
          return {
            stuckCount: next.stuckCount,
            quarantinedAnnoIds: next.quarantinedAnnoIds,
            hasPending: next.hasPending,
          };
        });
      } catch {
        if (cancelled) return;
        setState((prev) => (
          prev.stuckCount === 0 && !prev.hasPending && prev.quarantinedAnnoIds.length === 0
            ? prev
            : EMPTY_OUTBOX_RETRY
        ));
      }
    }

    tick();
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [userId]);

  return state;
}

void STUCK_THRESHOLD_MS;
