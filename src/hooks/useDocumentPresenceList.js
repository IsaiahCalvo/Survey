/**
 * useDocumentPresenceList.js — hook exposing the live viewer list for a document.
 *
 * Exports useDocumentPresenceList({ documentId, enabled }). It subscribes to
 * document_presence WAL events and applies them INCREMENTALLY to a local roster
 * (see presenceRoster.js) instead of re-SELECTing the whole table on every
 * event — that per-event re-fetch was audit #4's presence chatter. A single
 * server snapshot is read when the channel reaches SUBSCRIBED (and again on each
 * reconnect, since events during a drop are lost); events that land while the
 * snapshot is in flight are buffered and replayed on top, so no join/leave is
 * missed. Stale viewers (unclean disconnect, last_seen > 2 min) age out locally
 * on a visible-tab maintenance tick with NO network — a lone viewer does zero
 * polling. Powers the stacked-avatars row by the sync chip.
 */
import { useEffect, useRef, useState } from 'react';
import {
  getDocumentPresence,
  subscribeToDocumentPresence
} from '../services/documentAnnotationService';
import {
  applyPresenceEvent,
  seedRoster,
  ageOutRoster,
  rosterFromMap,
  rostersEqual
} from './presenceRoster.js';

// Local age-out cadence. Network reads do NOT happen on this interval; it only
// drops stale rows client-side so an unclean disconnect disappears within ~2 min.
const MAINTENANCE_INTERVAL_MS = 30000;
// If realtime never reaches SUBSCRIBED (disabled/unavailable), seed once anyway
// after this delay so the list still paints.
const SEED_FALLBACK_MS = 3000;

export function useDocumentPresenceList({ documentId, enabled = true } = {}) {
  const [presence, setPresence] = useState([]);
  const rosterRef = useRef([]);

  useEffect(() => {
    if (!enabled || !documentId) {
      rosterRef.current = [];
      setPresence([]);
      return;
    }

    let cancelled = false;
    const map = new Map();
    const buffer = [];
    let seeded = false;
    let seedInFlight = false;
    let pendingReseed = false;

    const now = () => Date.now();

    const commit = () => {
      ageOutRoster(map, now());
      const next = rosterFromMap(map);
      rosterRef.current = next;
      setPresence((prev) => (rostersEqual(prev, next) ? prev : next));
    };

    const seed = async () => {
      // Coalesce overlapping seed requests — but a reconnect SUBSCRIBED that
      // lands while a seed is in flight must NOT be dropped; defer it so a fresh
      // snapshot runs once the current one finishes (the in-flight snapshot may
      // predate the reconnect gap).
      if (seedInFlight) { pendingReseed = true; return; }
      seedInFlight = true;
      pendingReseed = false;
      // Buffer live events until this snapshot lands, so events arriving during
      // the read window (initial OR a reconnect re-sync) are replayed, not lost
      // or clobbered by a slightly-stale snapshot.
      seeded = false;
      try {
        const { data } = await getDocumentPresence(documentId);
        if (cancelled) return;
        seedRoster(map, Array.isArray(data) ? data : [], buffer, now());
        buffer.length = 0;
        seeded = true;
        commit();
      } catch (err) {
        if (cancelled) return;
        // Presence is non-critical; resume live mode with whatever buffered while
        // we tried, rather than freezing the roster behind a failed read.
        for (const evt of buffer) applyPresenceEvent(map, evt, now());
        buffer.length = 0;
        seeded = true;
        console.warn('[Presence] seed failed: ' + (err?.message || String(err)));
      } finally {
        seedInFlight = false;
        if (pendingReseed && !cancelled) seed(); // honor a reconnect deferred above
      }
    };

    const onEvent = (evt) => {
      if (cancelled) return;
      // Buffer until the first snapshot lands so an event that arrives between
      // subscribe and seed is replayed, not dropped.
      if (!seeded) {
        buffer.push(evt);
        return;
      }
      applyPresenceEvent(map, evt, now());
      commit();
    };

    // Subscribe FIRST, then seed when the channel is live. Re-seeding on every
    // SUBSCRIBED also re-syncs the roster after a websocket reconnect.
    const unsub = subscribeToDocumentPresence(documentId, onEvent, {
      onSubscribed: () => { if (!cancelled) seed(); }
    });

    const seedFallback = setTimeout(() => {
      if (!cancelled && !seeded) seed();
    }, SEED_FALLBACK_MS);

    // Visible-tab maintenance: age out stale rows locally (no network).
    const maintenance = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!seeded) return;
      commit();
    }, MAINTENANCE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(seedFallback);
      clearInterval(maintenance);
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [documentId, enabled]);

  return presence;
}
