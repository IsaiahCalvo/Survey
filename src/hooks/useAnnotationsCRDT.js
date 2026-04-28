// src/hooks/useAnnotationsCRDT.js
// Phase 29 — Tear-free React subscription to the Y.Doc annotations + callouts state.
//
// Source: 29-RESEARCH.md Example 3 (lines 705-765); Pattern 4 (lines 243-292).
//
// UX rationale (CONTEXT.md "Bridge mechanics — One direction at a time"):
// SVG layer reads annotations from React state. Phase 29 swaps the source of that
// state from useState/setAnnotationsByPage (legacy) to this hook (Y.Doc-derived).
// SVGAnnotationLayer is BYTE-IDENTICAL — it just consumes a different upstream.
//
// Why useSyncExternalStore (not useState + useEffect):
//   React 18 concurrent rendering can call getSnapshot multiple times during a single
//   render. Without useSyncExternalStore's tear-prevention, two reads in the same
//   render could see different values (one before, one after a Y.Doc transaction).
//
// Why observeDeep on each Y.Map (not on ydoc, not per-annotation):
//   - observeDeep on ydoc fires for ANY change in the entire document — too broad.
//   - observe per-annotation is N subscriptions for N annotations — painful at 500+.
//   - observeDeep on the parent Y.Map is one subscription that batches all per-anno
//     events into one callback per transaction.
//
// Why memoize via snapshotRef:
//   Without memoization, every render runs the full O(n) toJSON materialization.
//   With the ref, materialization runs once per Y.Doc transaction batch.

import { useSyncExternalStore, useCallback, useRef } from 'react';
import { useYDoc } from './useYDoc.js';

/** Frozen empty constant. Reference equality during hydration prevents spurious re-renders. */
const EMPTY_BY_PAGE = Object.freeze({});

/**
 * Subscribe to Y.Doc annotations + callouts and materialize the
 * { [pageNumber]: { objects: [...] } } shape SVGAnnotationLayer consumes.
 *
 * @returns {Readonly<Record<string, { objects: Array<object> }>>}
 */
export function useAnnotationsCRDT() {
  const { ydoc, isHydrating } = useYDoc();
  const snapshotRef = useRef(EMPTY_BY_PAGE);

  const subscribe = useCallback((callback) => {
    if (!ydoc) return () => {};
    const yMapAnno = ydoc.getMap('annotations');
    const yMapCallouts = ydoc.getMap('callouts');

    const handler = () => {
      // Invalidate cached snapshot so next getSnapshot recomputes.
      // observeDeep batches per transaction so this fires once per ydoc.transact().
      snapshotRef.current = null;
      callback();
    };

    // observeDeep on each top-level Y.Map separately. NOT on ydoc itself (anti-pattern).
    yMapAnno.observeDeep(handler);
    yMapCallouts.observeDeep(handler);

    return () => {
      yMapAnno.unobserveDeep(handler);
      yMapCallouts.unobserveDeep(handler);
    };
  }, [ydoc]);

  const getSnapshot = useCallback(() => {
    if (!ydoc) return EMPTY_BY_PAGE;
    if (isHydrating) return EMPTY_BY_PAGE;
    if (snapshotRef.current) return snapshotRef.current;

    // Materialize Y.Map<id, Y.Map> → { [pageNumber]: { objects: [...] } }
    // Shape matches the existing annotationsByPage state SVGAnnotationLayer reads.
    const yMapAnno = ydoc.getMap('annotations');
    const yMapCallouts = ydoc.getMap('callouts');
    const byPage = {};

    yMapAnno.forEach((annoYMap, id) => {
      const json = annoYMap.toJSON();
      const page = String(json.pageNumber);
      if (!byPage[page]) byPage[page] = { objects: [] };
      byPage[page].objects.push({
        ...(json.fabric ?? {}),
        data: { id, ...(json.fabric?.data ?? {}) },
        // Phase 29 augments with meta surfaced for awareness consumers (Plan 29-06):
        __meta: json.meta,
      });
    });

    // Callouts share the same shape; pageNumber field semantics match.
    yMapCallouts.forEach((calloutYMap, id) => {
      const json = calloutYMap.toJSON();
      const page = String(json.pageNumber);
      if (!byPage[page]) byPage[page] = { objects: [] };
      byPage[page].objects.push({
        ...(json.fabric ?? {}),
        data: { id, ...(json.fabric?.data ?? {}) },
        __meta: json.meta,
        __isCallout: true,
      });
    });

    snapshotRef.current = Object.freeze(byPage);
    return snapshotRef.current;
  }, [ydoc, isHydrating]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export default useAnnotationsCRDT;
