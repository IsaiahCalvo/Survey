/**
 * useCrossPageMove — the page-layer side of "drag a mark onto the next page"
 * (owner after Test 46; rule in utils/crossPageMove.js).
 *
 * The drag stays owned by the page it started on (its useSVGInteraction keeps
 * the pointer). This hook only:
 *   - previews: the mark follows the pointer off its page unclamped (the page
 *     SVG clips it), and once it is 100 % off and the pointer is over another
 *     page its picture is drawn on that page (crossPageGhost) while the
 *     original is hidden;
 *   - drops: on another page it hands the moved marks to the viewer
 *     (onMoveMarksToPage), which saves the move as ONE change and ONE undo
 *     step on both pages. Anything else falls back to the in-page move;
 *   - cancels (Escape): the picture goes away and the mark stays put.
 * The returned object is stable, so the interaction callbacks keep their deps.
 */
import { useEffect, useMemo, useRef } from 'react';
import { getAnnotationWorldAABB } from '../utils/svgBoundingBox';
import { roundCommittedAnnotationsGeometry } from '../utils/annotationCommitRounding.js';
import { markIdOf } from '../utils/moveCommit.js';
import {
  canSelectionCrossPages,
  clientToPagePoint,
  getCrossPageGhost,
  readPageLayers,
  resolveCrossPageDrop,
  resolveCrossPageStep,
  setCrossPageGhost,
  translateMovedMark,
  unionBox,
} from '../utils/crossPageMove.js';

export function useCrossPageMove({
  svgRef, pageNumber, documentId, onMoveMarksToPage, setVisualTransform, selectedCount,
}) {
  const latestRef = useRef(null);
  latestRef.current = { svgRef, pageNumber, documentId, onMoveMarksToPage, setVisualTransform, selectedCount };

  const api = useMemo(() => {
    // The drag-start facts, computed once per drag (false = this drag never crosses).
    const begin = (ds, objects) => {
      if (ds.crossPage !== undefined) return ds.crossPage;
      const L = latestRef.current;
      ds.crossPage = false;
      if (typeof L.onMoveMarksToPage !== 'function' || !ds.startSVGPoint) return false;
      let indices;
      let starts;
      if (ds.mode === 'move') {
        if (ds.orbitBase) return false;
        indices = [ds.annotationIndex];
        starts = [{ left: ds.originalProps?.left, top: ds.originalProps?.top }];
      } else if (ds.mode === 'group-move') {
        const calloutCount = Object.keys(ds.groupCalloutOriginals || {}).length;
        const markerCount = Array.isArray(ds.groupMarkerIds) ? ds.groupMarkerIds.length : 0;
        if (calloutCount > 0 || markerCount > 0) return false;
        indices = Object.keys(ds.groupOriginals || {}).map(Number);
        starts = indices.map((index) => ds.groupOriginals[index]);
      } else {
        return false;
      }
      const marks = indices.map((index) => objects?.[index]);
      if (marks.some((mark) => !mark)) return false;
      const selectedCount = ds.mode === 'group-move' ? L.selectedCount : null;
      if (!canSelectionCrossPages(marks, { selectedCount })) return false;
      const startBox = unionBox(marks.map((mark) => getAnnotationWorldAABB(mark)));
      if (!startBox) return false;
      ds.crossPage = {
        originPage: L.pageNumber,
        hostPage: L.pageNumber,
        indices,
        starts,
        marks,
        ids: marks.map(markIdOf),
        startBox,
        grabOffset: { x: ds.startSVGPoint.x - startBox.left, y: ds.startSVGPoint.y - startBox.top },
        box: null,
      };
      return ds.crossPage;
    };

    const step = (state, event, pages) => resolveCrossPageStep({
      pages,
      hostPage: state.hostPage,
      pointer: { x: event.clientX, y: event.clientY },
      grabOffset: state.grabOffset,
      size: { width: state.startBox.width, height: state.startBox.height },
    });

    return {
      /** pointermove of a move / group-move. true = this hook drew the frame. */
      preview(ds, event, objects) {
        const state = begin(ds, objects);
        if (!state) return false;
        const L = latestRef.current;
        const pages = readPageLayers();
        const origin = pages.find((page) => page.pageNumber === state.originPage);
        if (!origin) return false;
        const next = step(state, event, pages);
        if (!next.box) return false;
        state.hostPage = next.hostPage;
        state.box = next.box;
        const away = next.hostPage !== state.originPage;
        // On its own page the mark is drawn where the pointer puts it (no
        // page clamp — the page clips it). Away, it is hidden there.
        const at = clientToPagePoint(origin.matrix, event.clientX, event.clientY);
        const dx = at.x - ds.startSVGPoint.x;
        const dy = at.y - ds.startSVGPoint.y;
        L.setVisualTransform(ds.mode === 'group-move'
          ? { id: 'group', dx, dy, affectedIds: new Set(state.indices), crossPageAway: away }
          : { id: ds.annotationIndex, dx, dy, crossPageAway: away });
        setCrossPageGhost(away ? {
          documentId: L.documentId ?? null,
          originPage: state.originPage,
          pageNumber: next.hostPage,
          objects: state.marks,
          dx: next.box.left - state.startBox.left,
          dy: next.box.top - state.startBox.top,
        } : null);
        return true;
      },

      /** pointerup. true = the marks were moved to another page (saved). */
      drop(ds, event) {
        const state = ds.crossPage;
        if (!state || state.hostPage === state.originPage) return false;
        const L = latestRef.current;
        const pages = readPageLayers();
        const last = step(state, event, pages);
        const landing = resolveCrossPageDrop({
          pages,
          originPage: state.originPage,
          hostPage: last.hostPage,
          box: last.box,
        });
        if (!landing) return false;
        const tx = landing.box.left - state.startBox.left;
        const ty = landing.box.top - state.startBox.top;
        const moved = { objects: state.marks.map((mark, k) => translateMovedMark(mark, state.starts[k], tx, ty)) };
        roundCommittedAnnotationsGeometry(moved, moved.objects.map((_, k) => k));
        const ok = L.onMoveMarksToPage({
          toPage: landing.pageNumber,
          marks: moved.objects.map((object, k) => ({ id: state.ids[k], object })),
        });
        return ok === true;
      },

      /** The drag is over (saved, cancelled or dropped in place). */
      end(ds) {
        if (ds?.crossPage && getCrossPageGhost()) setCrossPageGhost(null);
      },
    };
  }, []);

  // A page layer that goes away mid-drag never leaves a picture behind.
  useEffect(() => () => {
    const current = getCrossPageGhost();
    if (current && current.originPage === latestRef.current?.pageNumber) setCrossPageGhost(null);
  }, []);

  return api;
}
