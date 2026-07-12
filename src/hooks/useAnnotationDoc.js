// src/hooks/useAnnotationDoc.js
//
// Connects the viewer's React annotation state to the durable Yjs store
// (annotationDocSync). This is the rebuild's app-side seam: a thin capture +
// hydrate layer that sits AROUND the existing `annotationsByPage` / `callouts`
// state, so everything that already produces that state — draw, erase, edit,
// undo/redo, embedded import — becomes durable automatically, with no changes to
// any of that logic.
//
// How it stays loop-free without flags: pushing state into the store is a
// minimal diff (syncByPageToDoc / setMeta produce ZERO ops when nothing
// changed), so re-capturing store-originated state is a harmless no-op. Local
// edits do NOT echo back from the store (the sync layer only notifies on REMOTE
// ops), so the viewer's per-page render metadata is never clobbered.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient.js';
import { openAnnotationDoc, getClientId } from '../services/annotationDocSync.js';
import { setMetaValue as setMetaValueOnDoc } from '../services/annotationDocStore.js';
import { calloutsInSharedStore } from '../lib/calloutSharedStoreFlag.js';
import { projectCalloutsIntoByPage as projectCalloutsIntoByPageShared } from '../utils/calloutAnnotationBridge.js';

const CALLOUTS_KEY = 'calloutsList';
const SPACES_KEY = 'spaces';

function pageCount(byPage) {
  let n = 0;
  for (const k of Object.keys(byPage || {})) n += (byPage[k]?.objects?.length || 0);
  return n;
}

// ---------------------------------------------------------------------------
// Callout-unification keystone (Phase 5) — CLOUD hydrate → annotationsByPage
// projection.
//
// `useAnnotationDoc` is the LIVE cloud hydration seam (the legacy
// `useAnnotationCloudSync` hydrate effect is dead — invoked with
// hydrateEnabled=false). Cloud docs deliver callouts as a document-level META
// list (`calloutsList`), entirely separate from the per-page `byPage` map; they
// are applied to React state via `setCallouts(...)`. When the shared store is
// ON, the SVG render path renders callouts ONLY from `annotationsByPage`
// (SVGAnnotationLayer's `data.type==='callout'` branch) and SUPPRESSES the
// legacy `filteredCallouts` loop (`if (calloutsShared) return []`). So without
// this projection a cloud doc's callouts would VANISH under the flag.
//
// `projectCalloutsIntoByPage` rebuilds the callout layer of `byPage` FROM the
// authoritative callout list on every hydrate:
//   • strips any pre-existing `data.type==='callout'` objects (so a re-hydrate
//     with a removed callout doesn't leave a ghost), then
//   • re-projects each callout via the round-trip-verified bridge,
//     de-duplicating by id within the projection.
// This rebuild-from-source design is inherently IDEMPOTENT across the multiple
// hydrate fires (initial durable-wins + every remote `onChange`): the output is
// a pure function of (non-callout objects, callout list), so re-running never
// doubles a callout. Non-callout objects are always preserved untouched.
//
// pageSize per page = the unscaled PDF page-pixel size (pageSizesRef.current),
// which is exactly the {width,height} the SVG layer inverts with — so the bridge
// forward/inverse round-trip is lossless (mirrors PDFViewer's local point-A
// projection). Flag OFF → returns `byPage` unchanged (referentially identical
// when no callouts), so behavior is byte-for-byte the same.
//
// The actual rebuild-from-source logic now lives in the canonical
// `projectCalloutsIntoByPage` exported from calloutAnnotationBridge.js, shared
// verbatim with PDFViewer's local reactive effect so the two never drift. This
// thin wrapper just adds the flag gate (the bridge stays flag-agnostic so it is
// importable in Node --test).
function projectCalloutsIntoByPage(byPage, calloutsList, pageSizes) {
  if (!calloutsInSharedStore()) return byPage;
  return projectCalloutsIntoByPageShared(byPage, calloutsList, pageSizes);
}

export function useAnnotationDoc({
  documentId,
  userId,
  enabled,
  annotationsByPage,
  setAnnotationsByPage,
  callouts,
  setCallouts,
  spaces,
  setSpaces,
  surveyMarkers,
  setSurveyMarkers,
  // Callout-unification keystone (Phase 5): the unscaled per-page PDF pixel sizes
  // ({ [page]: { width, height } }) the SVG layer inverts callouts with. Passed
  // as a ref so the projection reads the latest measured sizes at hydrate time
  // (sizes may arrive after the doc opens). Only consulted when the shared-store
  // flag is ON; safe to omit when the flag is OFF.
  pageSizesRef,
  // Callout-unification keystone (Phase 5) — BLOCKER 2 fix. A reactive count of
  // how many pages have been MEASURED (Object.keys(pageSizes).length). The
  // initial cloud-hydration projection (durable-wins, below) can fire before any
  // page is measured (pageSizesRef.current === {}), projecting callouts at the
  // US-Letter fallback — wrong first-paint position on non-Letter pages. This
  // signal lets a re-projection effect re-run once real dims arrive. Only used
  // when the shared-store flag is ON; flag OFF → effect early-returns (no-op).
  pageSizesReady = 0,
}) {
  const handleRef = useRef(null);
  const readyRef = useRef(false);
  const byPageRef = useRef(annotationsByPage);
  const calloutsRef = useRef(callouts);
  const spacesRef = useRef(spaces);
  const surveyMarkersRef = useRef(surveyMarkers);
  // Callout-unification keystone (Phase 5) — BLOCKER 2 fix. Tracks whether the
  // initial cloud-hydration projection ran while pageSizes was still empty, so
  // the re-projection effect knows it has stale-pageSize work to redo. Reset on
  // every doc open.
  const calloutProjectedWithoutSizesRef = useRef(false);
  const [initialHydration, setInitialHydration] = useState({ ready: false, source: 'pending', count: 0, documentId: null });
  const [syncStatus, setSyncStatus] = useState({ stage: 'idle', healthy: true, error: null });
  const [syncQueueSize, setSyncQueueSize] = useState(0);

  byPageRef.current = annotationsByPage;
  calloutsRef.current = callouts;
  spacesRef.current = spaces;
  surveyMarkersRef.current = surveyMarkers;

  // Open the durable doc on documentId; hydrate from it (authoritative) or seed
  // it with whatever the viewer already has (covers marks drawn/imported before
  // the id resolved).
  useEffect(() => {
    if (!enabled || !documentId || !userId) {
      setSyncStatus({ stage: 'idle', healthy: true, error: null });
      setSyncQueueSize(0);
      return undefined;
    }
    let cancelled = false;
    let unsubscribeSync = null;
    readyRef.current = false;
    // BLOCKER 2: new doc — clear any "projected with stale pageSize" flag.
    calloutProjectedWithoutSizesRef.current = false;
    setInitialHydration({ ready: false, source: 'pending', count: 0, documentId });
    setSyncStatus({ stage: 'hydrating', healthy: true, error: null });
    setSyncQueueSize(0);

    (async () => {
      let handle;
      try {
        handle = await openAnnotationDoc({ documentId, supabase, clientId: getClientId() });
      } catch (err) {
        console.error('[useAnnotationDoc] open failed', err?.message);
        if (!cancelled) {
          setSyncStatus({ stage: 'error', healthy: false, error: err?.message || 'sync failed' });
          setSyncQueueSize(0);
        }
        return;
      }
      if (cancelled) { try { await handle.destroy(); } catch { /* */ } return; }
      handleRef.current = handle;
      const updateSyncStatus = (next) => {
        if (cancelled || !next) return;
        setSyncStatus({
          stage: next.stage || (next.healthy === false ? 'error' : 'idle'),
          healthy: next.healthy !== false,
          error: next.error || null,
        });
        setSyncQueueSize(Math.max(0, Number(next.queueSize) || 0));
      };
      updateSyncStatus(handle.getSyncStatus?.());
      unsubscribeSync = handle.onSyncStatus?.(updateSyncStatus) || null;

      // Remote ops (other devices) → reflect into React state.
      handle.onChange((byPage) => {
        if (cancelled) return;
        const c = handle.getMeta(CALLOUTS_KEY);
        // Keystone (flag ON): also project the realtime callout list into the
        // shared byPage so a collaborator's callouts render via the shared
        // dispatch (the legacy filteredCallouts loop is suppressed under the
        // flag). callouts[] stays populated below (dual-rep). Flag OFF → byPage
        // unchanged. Idempotent: projectCalloutsIntoByPage rebuilds the callout
        // layer from `c` each time, so repeated remote ops never double-render.
        setAnnotationsByPage(projectCalloutsIntoByPage(byPage, c, pageSizesRef?.current));
        if (Array.isArray(c)) setCallouts(c);
        const s = handle.getMeta(SPACES_KEY);
        if (Array.isArray(s)) setSpaces(s);
        const sm = handle.getSurveyMarkers();
        if (sm && typeof sm === 'object') setSurveyMarkers(sm);
      });

      const storeByPage = handle.getByPage();
      const storeCallouts = handle.getMeta(CALLOUTS_KEY);
      const storeSpaces = handle.getMeta(SPACES_KEY);
      const storeSurvey = handle.getSurveyMarkers();
      const count = pageCount(storeByPage);
      const hasCallouts = Array.isArray(storeCallouts) && storeCallouts.length > 0;
      const hasSpaces = Array.isArray(storeSpaces) && storeSpaces.length > 0;
      const hasSurvey = storeSurvey && Object.keys(storeSurvey).length > 0;

      if (count > 0 || hasCallouts || hasSpaces || hasSurvey) {
        // Durable store wins — paint from it.
        // Keystone (flag ON): project the durable callout list into the store's
        // byPage so callouts render via the shared dispatch. We may need to set
        // byPage even when count === 0 (a callout-only cloud doc) so the
        // projected callouts reach the layer. When the flag is OFF,
        // projectCalloutsIntoByPage returns storeByPage unchanged, so the
        // `count > 0` guard below is preserved byte-for-byte.
        const projectedByPage = projectCalloutsIntoByPage(storeByPage, storeCallouts, pageSizesRef?.current);
        const calloutsWereProjected = projectedByPage !== storeByPage;
        // BLOCKER 2: if we projected callouts before any page was measured, the
        // callouts landed at the US-Letter fallback. Remember so the re-projection
        // effect can re-run once real dims arrive. (Idempotent + flag-gated; with
        // the flag OFF calloutsWereProjected is false → never set.)
        if (calloutsWereProjected && hasCallouts) {
          const sizesNow = pageSizesRef?.current || {};
          if (Object.keys(sizesNow).length === 0) {
            calloutProjectedWithoutSizesRef.current = true;
          }
        }
        if (count > 0 || calloutsWereProjected) setAnnotationsByPage(projectedByPage);
        if (hasCallouts) setCallouts(storeCallouts);
        if (hasSpaces) setSpaces(storeSpaces);
        if (hasSurvey) setSurveyMarkers(storeSurvey);
        // Document-level kinds: if the store has SOME state but not this kind yet
        // (first open after each kind's migration shipped), seed it from the
        // per-device state the viewer already loaded so nothing is dropped.
        if (!hasSpaces) {
          const curSpaces = spacesRef.current;
          if (Array.isArray(curSpaces) && curSpaces.length > 0) handle.setMeta(SPACES_KEY, curSpaces);
        }
        if (!hasSurvey) {
          const curSurvey = surveyMarkersRef.current;
          if (curSurvey && Object.keys(curSurvey).length > 0) handle.applySurveyMarkers(curSurvey);
        }
      } else {
        // Empty store: seed it with whatever the viewer already holds so a mark
        // drawn (or imported) before this point is captured durably.
        const curByPage = byPageRef.current;
        if (curByPage && pageCount(curByPage) > 0) handle.applyByPage(curByPage);
        const curCallouts = calloutsRef.current;
        if (Array.isArray(curCallouts) && curCallouts.length > 0) handle.setMeta(CALLOUTS_KEY, curCallouts);
        const curSpaces = spacesRef.current;
        if (Array.isArray(curSpaces) && curSpaces.length > 0) handle.setMeta(SPACES_KEY, curSpaces);
        const curSurvey = surveyMarkersRef.current;
        if (curSurvey && Object.keys(curSurvey).length > 0) handle.applySurveyMarkers(curSurvey);
      }

      readyRef.current = true;
      // Drives the existing "import embedded marks when empty" effect: a
      // never-imported PDF hydrates empty (count 0) → that effect runs the
      // importer → its marks flow back through capture below → durable.
      setInitialHydration({ ready: true, source: 'annotation-doc', count, documentId });
    })();

    return () => {
      cancelled = true;
      const h = handleRef.current;
      handleRef.current = null;
      readyRef.current = false;
      unsubscribeSync?.();
      if (h) { h.destroy().catch(() => {}); }
    };
  }, [enabled, documentId, userId, setAnnotationsByPage, setCallouts, setSpaces, setSurveyMarkers]);

  // Callout-unification keystone (Phase 5) — BLOCKER 2 fix: re-project callouts
  // once pageSizes first becomes available. The initial durable-wins hydration
  // can project callouts before any page is measured (US-Letter fallback → wrong
  // first-paint position on non-Letter pages). When real dims arrive we re-run
  // the projection against the CURRENT annotationsByPage (which already holds any
  // live non-callout work) using the CURRENT callout list and now-measured sizes.
  // projectCalloutsIntoByPage strips existing callout objects and re-projects
  // from the list, so this corrects positions while preserving everything else —
  // it is idempotent and safe to run more than once. Flag OFF → early return
  // (calloutsInSharedStore() false), so this is a no-op → byte-for-byte identical.
  useEffect(() => {
    if (!calloutsInSharedStore()) return;
    if (!readyRef.current) return;
    if (!calloutProjectedWithoutSizesRef.current) return;
    const sizes = pageSizesRef?.current || {};
    if (Object.keys(sizes).length === 0) return; // sizes still not measured
    // One-shot: clear before re-projecting so we don't loop.
    calloutProjectedWithoutSizesRef.current = false;
    const curCallouts = calloutsRef.current;
    if (!Array.isArray(curCallouts) || curCallouts.length === 0) return;
    setAnnotationsByPage((prev) => projectCalloutsIntoByPage(prev, curCallouts, sizes));
  }, [pageSizesReady, setAnnotationsByPage, pageSizesRef]);

  // Capture annotation changes into the durable store (no-op when unchanged).
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    h.applyByPage(annotationsByPage);
  }, [annotationsByPage]);

  // Capture callout changes (coarse whole-list; no-op when unchanged).
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    h.setMeta(CALLOUTS_KEY, callouts);
  }, [callouts]);

  // Capture space changes (document-level; coarse whole-array, no-op when
  // unchanged). Spaces + their region polygons now live durably in the Y.Doc
  // instead of the localStorage/Storage-sidecar pair.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    h.setMeta(SPACES_KEY, spaces);
  }, [spaces]);

  // Capture survey-marker (highlight) changes into their keyed map (minimal
  // per-marker diff; no-op when unchanged). The Y.Doc is now the source of truth
  // for highlights — hydrate, realtime, and durability all flow through here.
  useEffect(() => {
    const h = handleRef.current;
    if (!h || !readyRef.current) return;
    h.applySurveyMarkers(surveyMarkers);
  }, [surveyMarkers]);

  // Cmd/Ctrl+S → drain pending appends + write a fresh snapshot.
  const forceFlush = useCallback(async () => {
    const h = handleRef.current;
    if (!h) return;
    setSyncStatus((prev) => ({ ...prev, stage: 'syncing' }));
    await h.drain();
    const saved = await h.flushSnapshot();
    const next = h.getSyncStatus?.() || {};
    setSyncStatus({
      stage: saved && next.healthy !== false ? 'idle' : 'error',
      healthy: saved && next.healthy !== false,
      error: saved ? null : (next.error || 'sync failed'),
    });
    setSyncQueueSize(Math.max(0, Number(next.queueSize) || 0));
  }, []);

  // KAL-309: expose the durable Y.Doc META map to the Excel-sync cutover so the
  // single `excelSyncFrontier:${templateId}` cursor + the durable review set live
  // in the same source-of-truth doc as the markers. `metaSet` takes an explicit
  // origin (the handle's setMeta hardcodes 'local'); 'excel-import' keeps these
  // writes additive + durable without tripping the survey-marker deletion gate.
  const metaGet = useCallback((key) => {
    const h = handleRef.current;
    return h ? h.getMeta(key) : undefined;
  }, []);
  const metaSet = useCallback((key, value, origin = 'excel-import') => {
    const h = handleRef.current;
    if (!h || !h.doc) return false;
    return setMetaValueOnDoc(h.doc, key, value, origin);
  }, []);

  return {
    initialHydration,
    forceFlush,
    metaGet,
    metaSet,
    status: syncStatus,
    queueSize: syncQueueSize,
  };
}
