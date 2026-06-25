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

const CALLOUTS_KEY = 'calloutsList';
const SPACES_KEY = 'spaces';

function pageCount(byPage) {
  let n = 0;
  for (const k of Object.keys(byPage || {})) n += (byPage[k]?.objects?.length || 0);
  return n;
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
}) {
  const handleRef = useRef(null);
  const readyRef = useRef(false);
  const byPageRef = useRef(annotationsByPage);
  const calloutsRef = useRef(callouts);
  const spacesRef = useRef(spaces);
  const surveyMarkersRef = useRef(surveyMarkers);
  const [initialHydration, setInitialHydration] = useState({ ready: false, source: 'pending', count: 0, documentId: null });

  byPageRef.current = annotationsByPage;
  calloutsRef.current = callouts;
  spacesRef.current = spaces;
  surveyMarkersRef.current = surveyMarkers;

  // Open the durable doc on documentId; hydrate from it (authoritative) or seed
  // it with whatever the viewer already has (covers marks drawn/imported before
  // the id resolved).
  useEffect(() => {
    if (!enabled || !documentId || !userId) return undefined;
    let cancelled = false;
    readyRef.current = false;
    setInitialHydration({ ready: false, source: 'pending', count: 0, documentId });

    (async () => {
      let handle;
      try {
        handle = await openAnnotationDoc({ documentId, supabase, clientId: getClientId() });
      } catch (err) {
        console.error('[useAnnotationDoc] open failed', err?.message);
        return;
      }
      if (cancelled) { try { await handle.destroy(); } catch { /* */ } return; }
      handleRef.current = handle;

      // Remote ops (other devices) → reflect into React state.
      handle.onChange((byPage) => {
        if (cancelled) return;
        setAnnotationsByPage(byPage);
        const c = handle.getMeta(CALLOUTS_KEY);
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
        if (count > 0) setAnnotationsByPage(storeByPage);
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
      if (h) { h.destroy().catch(() => {}); }
    };
  }, [enabled, documentId, userId, setAnnotationsByPage, setCallouts, setSpaces, setSurveyMarkers]);

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
    await h.drain();
    await h.flushSnapshot();
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

  return { initialHydration, forceFlush, metaGet, metaSet };
}
