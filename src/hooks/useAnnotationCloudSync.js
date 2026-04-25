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

  // ---- Hydrate + migrate on document open --------------------------------

  useEffect(() => {
    if (!enabled || !documentId || !userId || !pdfId) return;
    let cancelled = false;
    hydratedRef.current = false;

    (async () => {
      setStatus({ stage: 'hydrating' });
      const cloud = await loadAllNonHighlightAnnotations(documentId);
      if (cancelled) return;
      if (cloud.error) {
        setStatus({ stage: 'error', error: cloud.error, phase: 'hydrate' });
      } else {
        if (cloud.annotationsByPage && Object.keys(cloud.annotationsByPage).length > 0) {
          setAnnotationsByPage((prev) => mergeAnnotationsByPage(prev, cloud.annotationsByPage));
        }
        if (cloud.callouts && cloud.callouts.length > 0) {
          setCallouts((prev) => mergeCallouts(prev, cloud.callouts));
        }
      }

      setStatus({ stage: 'migrating' });
      const migration = await migrateLocalAnnotationsToCloud({
        documentId,
        userId,
        pdfId,
        onStatus: (s) => {
          if (!cancelled) setStatus({ stage: 'migrating', ...s });
        }
      });
      if (cancelled) return;
      if (migration.error) {
        setStatus({ stage: 'error', error: migration.error, phase: 'migrate' });
      } else {
        hydratedRef.current = true;
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
    if (!hydratedRef.current) return; // skip until initial hydrate finishes
    if (annotationsByPage === lastByPageRef.current) return;

    lastByPageRef.current = annotationsByPage;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(async () => {
      const result = await upsertAnnotationsByPage(annotationsByPage, { documentId, userId });
      if (result.error) {
        enqueueSync(documentId, {
          kind: 'fabric-bulk',
          payload: annotationsByPage,
          opts: { documentId, userId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [enabled, documentId, userId, annotationsByPage, debounceMs]);

  useEffect(() => {
    if (!enabled || !documentId || !userId) return;
    if (!hydratedRef.current) return;
    if (callouts === lastCalloutsRef.current) return;

    lastCalloutsRef.current = callouts;
    const handle = setTimeout(async () => {
      const result = await upsertCallouts(callouts || [], { documentId, userId });
      if (result.error) {
        enqueueSync(documentId, {
          kind: 'callout-bulk',
          payload: callouts || [],
          opts: { documentId, userId }
        });
        setQueueSize(getQueueSize(documentId));
        setStatus({ stage: 'queued', error: result.error });
      } else {
        setStatus({ stage: 'synced', count: result.data?.length || 0 });
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [enabled, documentId, userId, callouts, debounceMs]);

  // ---- Realtime subscription ---------------------------------------------

  useEffect(() => {
    if (!enabled || !documentId) return;

    const unsub = subscribeToAllNonHighlightAnnotations(documentId, {
      onFabricInsert: (fabricObject, pageNumber, highlightId) => {
        setAnnotationsByPage((prev) => insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId));
      },
      onFabricUpdate: (fabricObject, pageNumber, highlightId) => {
        setAnnotationsByPage((prev) => insertOrUpdateOnPage(prev, pageNumber, fabricObject, highlightId));
      },
      onFabricDelete: (highlightId) => {
        setAnnotationsByPage((prev) => removeFromAllPages(prev, highlightId));
      },
      onCalloutInsert: (callout) => {
        setCallouts((prev) => upsertCalloutInList(prev, callout));
      },
      onCalloutUpdate: (callout) => {
        setCallouts((prev) => upsertCalloutInList(prev, callout));
      },
      onCalloutDelete: (highlightId) => {
        setCallouts((prev) => (prev || []).filter((c) => (c.id ?? c.highlightId) !== highlightId));
      },
      onError: (err) => setStatus({ stage: 'error', error: err, phase: 'subscribe' })
    });

    return () => {
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [enabled, documentId, setAnnotationsByPage, setCallouts]);

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
      await upsertAnnotationsByPage(lastByPageRef.current, { documentId, userId });
    }
    if (lastCalloutsRef.current) {
      await upsertCallouts(lastCalloutsRef.current, { documentId, userId });
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
