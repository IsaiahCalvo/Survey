/**
 * useAnnotationCloudSync — Phase 21.
 *
 * React hook that wires the all-types cloud sync into App.jsx with a
 * minimal surface. Mount it once per open document and it handles:
 *   - Hydrating non-highlight annotations from the cloud on document open
 *   - Running the one-time local-to-cloud migration for stranded marks
 *   - Pushing per-page Fabric state diffs and callout state diffs to the
 *     cloud on change, debounced to avoid hammering Supabase mid-drag
 *   - Subscribing to realtime row changes and merging incoming
 *     inserts/updates/deletes into the local state slices
 *   - Falling back to localStorage when Supabase is unreachable and
 *     replaying queued upserts on reconnect
 *
 * Highlights are intentionally NOT touched — they keep their existing
 * sync path in documentAnnotationService.js.
 */

import { useEffect, useRef, useState } from 'react';
import {
  upsertAnnotationsByPage,
  upsertCallouts,
  loadAllNonHighlightAnnotations,
  subscribeToAllNonHighlightAnnotations,
  deleteAnnotation
} from '../services/annotationCloudSync.js';
import { migrateLocalAnnotationsToCloud } from '../services/cloudSyncMigration.js';
import {
  enqueueSync,
  drainQueue,
  getQueueSize
} from '../services/cloudSyncQueue.js';

const DEFAULT_DEBOUNCE_MS = 800; // mid-drag pushes are coalesced into one upsert

/**
 * @param {object} args
 * @param {string|null} args.documentId        - Supabase document ID (UUID)
 * @param {string|null} args.userId            - Supabase user ID (UUID)
 * @param {string|null} args.pdfId             - Local localStorage key suffix
 * @param {object} args.annotationsByPage      - { [pageNum]: { objects: [...] } }
 * @param {Array}  args.callouts               - [{ id, pageNumber, anchor, knee, label, ... }]
 * @param {Function} args.setAnnotationsByPage - React setter
 * @param {Function} args.setCallouts          - React setter
 * @param {boolean} [args.enabled=true]        - Master switch (e.g. user toggled cloud sync off)
 * @param {number}  [args.debounceMs=800]      - Push debounce window
 *
 * @returns {{ status: object, queueSize: number, forceFlush: () => Promise<void> }}
 */
export function useAnnotationCloudSync({
  documentId,
  userId,
  pdfId,
  annotationsByPage,
  callouts,
  setAnnotationsByPage,
  setCallouts,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS
} = {}) {
  const [status, setStatus] = useState({ stage: 'idle' });
  const [queueSize, setQueueSize] = useState(0);

  const lastByPageRef = useRef(null);
  const lastCalloutsRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const hydratedRef = useRef(false);

  // Per-tab / per-Electron-process session id used by the echo filter so
  // the same user's OTHER device (a different session) still receives live
  // updates. Generated once per hook lifetime; survives across documents.
  const sessionIdRef = useRef(null);
  if (sessionIdRef.current === null) {
    const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionIdRef.current = rnd;
    console.log('[CloudSync][hook] session id minted ' + JSON.stringify({ sessionId: rnd }));
  }
  const clientSessionId = sessionIdRef.current;

  // Belt-and-suspenders echo filter — track every highlight_id this client
  // pushes and drop realtime events for those ids for a short window. This
  // protects against any case where the session-id filter fails (legacy
  // rows without sessionId in annotation_data, serializer regenerating ids
  // mid-flight, etc.) while still letting OTHER devices' writes through
  // since their ids never enter this set. TTL is generous (60s) because
  // Supabase realtime can lag under network jitter.
  const recentlyPushedRef = useRef(new Map()); // id -> expiresAt epoch ms
  const PUSHED_ID_TTL_MS = 60_000;
  const markPushedIds = (ids) => {
    if (!ids || ids.length === 0) return;
    const now = Date.now();
    const map = recentlyPushedRef.current;
    for (const id of ids) {
      if (id) map.set(id, now + PUSHED_ID_TTL_MS);
    }
    // Lazy GC — drop expired entries so the map doesn't grow unbounded
    // across long sessions with thousands of edits.
    if (map.size > 5000) {
      for (const [id, exp] of map) {
        if (exp <= now) map.delete(id);
      }
    }
  };
  const isRecentlyPushed = (id) => {
    if (!id) return false;
    const map = recentlyPushedRef.current;
    const exp = map.get(id);
    if (!exp) return false;
    if (exp <= Date.now()) {
      map.delete(id);
      return false;
    }
    return true;
  };

  // ---- Hydrate + migrate on document open --------------------------------

  useEffect(() => {
    console.log('[CloudSync][hook] hydrate effect fired ' + JSON.stringify({
      enabled, documentId, userId, pdfId
    }));
    if (!enabled || !documentId || !userId || !pdfId) {
      console.log('[CloudSync][hook] hydrate skipped — missing prerequisite ' + JSON.stringify({
        enabled, hasDocumentId: !!documentId, hasUserId: !!userId, hasPdfId: !!pdfId
      }));
      return;
    }
    let cancelled = false;
    hydratedRef.current = false;

    (async () => {
      setStatus({ stage: 'hydrating' });
      console.log('[CloudSync][hook] stage=hydrating');
      const cloud = await loadAllNonHighlightAnnotations(documentId);
      if (cancelled) {
        console.log('[CloudSync][hook] hydrate cancelled mid-flight');
        return;
      }
      if (cloud.error) {
        console.error('[CloudSync][hook] hydrate error ' + (cloud.error?.message || String(cloud.error)));
        setStatus({ stage: 'error', error: cloud.error, phase: 'hydrate' });
      } else {
        if (cloud.annotationsByPage && Object.keys(cloud.annotationsByPage).length > 0) {
          console.log('[CloudSync][hook] merging hydrated fabric annotations ' + JSON.stringify({
            pages: Object.keys(cloud.annotationsByPage).length
          }));
          setAnnotationsByPage((prev) => mergeAnnotationsByPage(prev, cloud.annotationsByPage));
        }
        if (cloud.callouts && cloud.callouts.length > 0) {
          console.log('[CloudSync][hook] merging hydrated callouts ' + JSON.stringify({
            count: cloud.callouts.length
          }));
          setCallouts((prev) => mergeCallouts(prev, cloud.callouts));
        }
      }

      setStatus({ stage: 'migrating' });
      console.log('[CloudSync][hook] stage=migrating (one-time local→cloud push)');
      const migration = await migrateLocalAnnotationsToCloud({
        documentId,
        userId,
        pdfId,
        onStatus: (s) => {
          if (!cancelled) {
            console.log('[CloudSync][hook] migration progress ' + JSON.stringify(s));
            setStatus({ stage: 'migrating', ...s });
          }
        }
      });
      if (cancelled) return;
      if (migration.error) {
        console.error('[CloudSync][hook] migration error ' + (migration.error?.message || String(migration.error)));
        setStatus({ stage: 'error', error: migration.error, phase: 'migrate' });
      } else {
        hydratedRef.current = true;
        console.log('[CloudSync][hook] hydrate+migrate complete — push gate OPEN ' + JSON.stringify({
          migrationPushed: migration.pushed
        }));
        setStatus({ stage: 'idle', migrationPushed: migration.pushed });
      }

      setQueueSize(getQueueSize(documentId));
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, documentId, userId, pdfId, setAnnotationsByPage, setCallouts]);

  // ---- Debounced push on state change ------------------------------------

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;
    if (!hydratedRef.current) {
      console.log('[CloudSync][hook] fabric push skipped — not hydrated yet');
      return;
    }
    if (annotationsByPage === lastByPageRef.current) return;

    lastByPageRef.current = annotationsByPage;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const pageCount = Object.keys(annotationsByPage || {}).length;
    const objectCount = Object.values(annotationsByPage || {}).reduce(
      (n, p) => n + (Array.isArray(p?.objects) ? p.objects.length : 0),
      0
    );
    console.log('[CloudSync][hook] fabric state changed — debounce push scheduled ' + JSON.stringify({
      pageCount,
      objectCount,
      debounceMs
    }));

    debounceTimerRef.current = setTimeout(async () => {
      console.log('[CloudSync][hook] fabric push debounce elapsed — pushing now');
      // Mark every id that we're about to push BEFORE the network call so
      // realtime echoes that arrive before the push promise resolves are
      // still filtered. Pull ids from the local fabric objects so we cover
      // the same population the serializer will see.
      const idsToMark = [];
      for (const page of Object.values(annotationsByPage || {})) {
        if (!page || !Array.isArray(page.objects)) continue;
        for (const obj of page.objects) {
          const id = obj?.id || obj?.data?.id;
          if (id) idsToMark.push(id);
        }
      }
      markPushedIds(idsToMark);
      const result = await upsertAnnotationsByPage(annotationsByPage, { documentId, userId, clientSessionId });
      // Mark ids returned by the upsert too — covers the case where the
      // serializer generated a brand-new highlight_id for an object that
      // didn't have one locally.
      if (Array.isArray(result?.data)) {
        markPushedIds(result.data.map((r) => r?.highlight_id).filter(Boolean));
      }
      if (result.error) {
        console.warn('[CloudSync][hook] fabric push failed → queued ' + JSON.stringify({
          error: result.error?.message || String(result.error)
        }));
        enqueueSync(documentId, {
          kind: 'fabric-bulk',
          payload: annotationsByPage,
          opts: { documentId, userId, clientSessionId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        console.log('[CloudSync][hook] fabric push synced ' + JSON.stringify({
          count: result.data?.length || 0
        }));
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [enabled, documentId, userId, annotationsByPage, debounceMs]);

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;
    if (!hydratedRef.current) {
      console.log('[CloudSync][hook] callout push skipped — not hydrated yet');
      return;
    }
    if (callouts === lastCalloutsRef.current) return;

    lastCalloutsRef.current = callouts;
    console.log('[CloudSync][hook] callout state changed — debounce push scheduled ' + JSON.stringify({
      count: Array.isArray(callouts) ? callouts.length : 0,
      debounceMs
    }));
    const handle = setTimeout(async () => {
      console.log('[CloudSync][hook] callout push debounce elapsed — pushing now');
      const calloutIds = (callouts || [])
        .map((c) => c?.id || c?.highlightId)
        .filter(Boolean);
      markPushedIds(calloutIds);
      const result = await upsertCallouts(callouts || [], { documentId, userId, clientSessionId });
      if (Array.isArray(result?.data)) {
        markPushedIds(result.data.map((r) => r?.highlight_id).filter(Boolean));
      }
      if (result.error) {
        console.warn('[CloudSync][hook] callout push failed → queued ' + JSON.stringify({
          error: result.error?.message || String(result.error)
        }));
        enqueueSync(documentId, {
          kind: 'callout-bulk',
          payload: callouts || [],
          opts: { documentId, userId, clientSessionId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        console.log('[CloudSync][hook] callout push synced ' + JSON.stringify({
          count: result.data?.length || 0
        }));
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [enabled, documentId, userId, callouts, debounceMs]);

  // ---- Realtime subscription ---------------------------------------------

  useEffect(() => {
    if (!enabled || !documentId) return;

    const unsub = subscribeToAllNonHighlightAnnotations(
      documentId,
      {
        onFabricInsert: (fabricObject, pageNumber, highlightId) => {
          if (isRecentlyPushed(highlightId)) {
            console.log('[CloudSync][hook] dropped own-write echo (recently-pushed set) ' + JSON.stringify({
              event: 'INSERT', highlightId, pageNumber
            }));
            return;
          }
          setAnnotationsByPage((prev) => insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId));
        },
        onFabricUpdate: (fabricObject, pageNumber, highlightId) => {
          if (isRecentlyPushed(highlightId)) {
            console.log('[CloudSync][hook] dropped own-write echo (recently-pushed set) ' + JSON.stringify({
              event: 'UPDATE', highlightId, pageNumber
            }));
            return;
          }
          setAnnotationsByPage((prev) => insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId));
        },
        onFabricDelete: (highlightId) => {
          if (isRecentlyPushed(highlightId)) {
            console.log('[CloudSync][hook] dropped own-write echo (recently-pushed set) ' + JSON.stringify({
              event: 'DELETE', highlightId
            }));
            return;
          }
          setAnnotationsByPage((prev) => removeFromAllPages(prev, highlightId));
        },
        onCalloutInsert: (callout) => {
          const id = callout?.id || callout?.highlightId;
          if (isRecentlyPushed(id)) {
            console.log('[CloudSync][hook] dropped own-write echo (recently-pushed set) ' + JSON.stringify({
              event: 'INSERT', highlightId: id, kind: 'callout'
            }));
            return;
          }
          setCallouts((prev) => upsertCalloutInList(prev, callout));
        },
        onCalloutUpdate: (callout) => {
          const id = callout?.id || callout?.highlightId;
          if (isRecentlyPushed(id)) {
            console.log('[CloudSync][hook] dropped own-write echo (recently-pushed set) ' + JSON.stringify({
              event: 'UPDATE', highlightId: id, kind: 'callout'
            }));
            return;
          }
          setCallouts((prev) => upsertCalloutInList(prev, callout));
        },
        onCalloutDelete: (highlightId) => {
          if (isRecentlyPushed(highlightId)) {
            console.log('[CloudSync][hook] dropped own-write echo (recently-pushed set) ' + JSON.stringify({
              event: 'DELETE', highlightId, kind: 'callout'
            }));
            return;
          }
          setCallouts((prev) => (prev || []).filter((c) => (c.id ?? c.highlightId) !== highlightId));
        },
        onError: (err) => setStatus({ stage: 'error', error: err, phase: 'subscribe' })
      },
      // Echo filter — drop realtime events that originated from THIS
      // session (this tab / this Electron process). Same user on a
      // different device has a different session id and still receives
      // updates. Falls back to user-id matching for legacy rows that
      // pre-date the sessionId field.
      { currentUserId: userId, currentSessionId: clientSessionId }
    );

    return () => {
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [enabled, documentId, userId, clientSessionId, setAnnotationsByPage, setCallouts]);

  // ---- Drain offline queue on reconnect ----------------------------------

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;

    let cancelled = false;
    const flush = async (entry) => {
      const { kind, payload, opts } = entry;
      if (kind === 'fabric-bulk') {
        const r = await upsertAnnotationsByPage(payload, opts);
        return { success: !r.error };
      }
      if (kind === 'callout-bulk') {
        const r = await upsertCallouts(payload, opts);
        return { success: !r.error };
      }
      if (kind === 'delete') {
        const r = await deleteAnnotation(opts.documentId, opts.highlightId);
        return { success: !!r.success };
      }
      return { success: false };
    };

    const tryDrain = async () => {
      if (cancelled) return;
      const { remaining } = await drainQueue(documentId, flush);
      if (!cancelled) setQueueSize(remaining);
    };

    const onOnline = () => { tryDrain(); };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('online', onOnline);
    }
    tryDrain();

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined' && window.removeEventListener) {
        window.removeEventListener('online', onOnline);
      }
    };
  }, [enabled, documentId, userId]);

  const forceFlush = async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!documentId || !userId) return;
    if (lastByPageRef.current) {
      await upsertAnnotationsByPage(lastByPageRef.current, { documentId, userId, clientSessionId });
    }
    if (lastCalloutsRef.current) {
      await upsertCallouts(lastCalloutsRef.current, { documentId, userId, clientSessionId });
    }
  };

  return { status, queueSize, forceFlush };
}

// ----------------------------------------------------------------------------
// Pure merge helpers
// ----------------------------------------------------------------------------

function mergeAnnotationsByPage(local, remote) {
  if (!remote) return local;
  const out = { ...(local || {}) };
  for (const [pageKey, page] of Object.entries(remote)) {
    if (!page || !Array.isArray(page.objects)) continue;
    const localPage = out[pageKey] || { objects: [] };
    const localIds = new Set(localPage.objects.map((o) => o.id || o.data?.id).filter(Boolean));
    const merged = [...localPage.objects];
    for (const obj of page.objects) {
      const id = obj.id || obj.data?.id;
      if (!id || !localIds.has(id)) merged.push(obj);
    }
    out[pageKey] = { ...localPage, objects: merged };
  }
  return out;
}

function mergeCallouts(local, remote) {
  if (!remote) return local;
  const out = [...(local || [])];
  const localIds = new Set(out.map((c) => c.id || c.highlightId).filter(Boolean));
  for (const c of remote) {
    const id = c.id || c.highlightId;
    if (!id || !localIds.has(id)) out.push(c);
  }
  return out;
}

function insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId) {
  const pageKey = String(pageNumber);
  const out = { ...(prev || {}) };
  const page = out[pageKey] || { objects: [] };
  const id = highlightId || fabricObject.id || fabricObject.data?.id;
  const idx = page.objects.findIndex((o) => (o.id || o.data?.id) === id);
  const nextObjects = idx >= 0
    ? page.objects.map((o, i) => (i === idx ? fabricObject : o))
    : [...page.objects, fabricObject];
  out[pageKey] = { ...page, objects: nextObjects };
  return out;
}

function removeFromAllPages(prev, highlightId) {
  if (!prev) return prev;
  const out = {};
  for (const [pageKey, page] of Object.entries(prev)) {
    if (!page || !Array.isArray(page.objects)) {
      out[pageKey] = page;
      continue;
    }
    const filtered = page.objects.filter((o) => (o.id || o.data?.id) !== highlightId);
    out[pageKey] = { ...page, objects: filtered };
  }
  return out;
}

function upsertCalloutInList(prev, callout) {
  const list = Array.isArray(prev) ? prev : [];
  const id = callout.id || callout.highlightId;
  const idx = list.findIndex((c) => (c.id || c.highlightId) === id);
  if (idx >= 0) {
    return list.map((c, i) => (i === idx ? callout : c));
  }
  return [...list, callout];
}
