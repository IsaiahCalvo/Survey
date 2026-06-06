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

const CALLOUTS_KEY = 'calloutsList';

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
}) {
  const handleRef = useRef(null);
  const readyRef = useRef(false);
  const byPageRef = useRef(annotationsByPage);
  const calloutsRef = useRef(callouts);
  const [initialHydration, setInitialHydration] = useState({ ready: false, source: 'pending', count: 0, documentId: null });

  byPageRef.current = annotationsByPage;
  calloutsRef.current = callouts;

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
      });

      const storeByPage = handle.getByPage();
      const storeCallouts = handle.getMeta(CALLOUTS_KEY);
      const count = pageCount(storeByPage);
      const hasCallouts = Array.isArray(storeCallouts) && storeCallouts.length > 0;

      if (count > 0 || hasCallouts) {
        // Durable store wins — paint from it.
        if (count > 0) setAnnotationsByPage(storeByPage);
        if (hasCallouts) setCallouts(storeCallouts);
      } else {
        // Empty store: seed it with whatever the viewer already holds so a mark
        // drawn (or imported) before this point is captured durably.
        const curByPage = byPageRef.current;
        if (curByPage && pageCount(curByPage) > 0) handle.applyByPage(curByPage);
        const curCallouts = calloutsRef.current;
        if (Array.isArray(curCallouts) && curCallouts.length > 0) handle.setMeta(CALLOUTS_KEY, curCallouts);
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
  }, [enabled, documentId, userId, setAnnotationsByPage, setCallouts]);

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

  // Cmd/Ctrl+S → drain pending appends + write a fresh snapshot.
  const forceFlush = useCallback(async () => {
    const h = handleRef.current;
    if (!h) return;
    await h.drain();
    await h.flushSnapshot();
  }, []);

  return { initialHydration, forceFlush };
}
