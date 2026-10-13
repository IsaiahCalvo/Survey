/**
 * useSelectionMoveCursor — the `move` cursor over a selected mark, under the
 * tools that can drag it.
 *
 * Intended UX (Drawboard canvas audit 2026-10-13, chunk 5): wherever a press
 * would MOVE the selection, the pointer says so with the `move` cursor —
 * whatever tool is armed. Under Select the mark's own hit target already
 * carries it. Under a Shapes (or other own-group) tool the selected mark can
 * still be dragged (hooks/useSelectionGrabHandoff.js), but its hit targets
 * only come alive at the press, so the hover showed the tool's crosshair over
 * a mark that a drag would move (measured: a selected rectangle's border
 * under the Rectangle tool read `crosshair`, and a drag there moved it).
 *
 * How: while such a tool is armed and this page has a grabbable selection,
 * each hover move asks the shared hit test (utils/annotationHitTest — the
 * same stroke / fill geometry the press uses, top-most mark first) what is
 * under the pointer. If it is a selected mark, the layer's <svg> gets
 * `data-selection-hover="move"` (styles.css turns that into `cursor: move`);
 * anywhere else the attribute goes and the tool's cursor comes back. A
 * hollow shape's empty middle is not the mark, so it keeps the crosshair —
 * a press there draws, exactly as before.
 *
 * Mouse and pen hover only (a finger has no cursor), at most once per frame,
 * and no React state: the attribute is set straight on the element.
 */
import { useEffect, useRef } from 'react';
import { resolveAnnotationAt } from '../utils/annotationHitTest.js';

export const SELECTION_HOVER_ATTR = 'data-selection-hover';

/**
 * Pure part: should a hover over `target` show the move cursor, given the
 * hit test's answer?
 * @param {Element | null} target — the hovered element (the layer's own <svg>
 *   when its marks are not live)
 * @param {SVGSVGElement} svg
 * @param {object | null} hit — resolveAnnotationAt result
 * @param {(hit: object) => boolean} isSelectedHit
 */
export function shouldShowSelectionMoveCursor(target, svg, hit, isSelectedHit) {
  // Only the bare layer: a handle or a live element keeps its own cursor.
  if (!svg || target !== svg) return false;
  if (!hit || (hit.kind !== 'annotation' && hit.kind !== 'callout')) return false;
  return Boolean(isSelectedHit?.(hit));
}

/**
 * @param {object} options
 * @param {{ current: SVGSVGElement | null }} options.svgRef
 * @param {boolean} options.enabled — a non-Select tool that may grab this
 *   page's selection is armed, and nothing is being dragged
 * @param {(hit: object) => boolean} options.isSelectedHit
 */
export function useSelectionMoveCursor({ svgRef, enabled, isSelectedHit }) {
  const isSelectedHitRef = useRef(isSelectedHit);
  isSelectedHitRef.current = isSelectedHit;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const clear = () => {
      if (svg.hasAttribute(SELECTION_HOVER_ATTR)) svg.removeAttribute(SELECTION_HOVER_ATTR);
    };
    if (!enabled) {
      clear();
      return undefined;
    }
    let lastAt = -Infinity;
    const onMove = (event) => {
      if (event.pointerType === 'touch' || event.buttons !== 0) {
        clear();
        return;
      }
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastAt < 16) return;
      lastAt = now;
      let hit = null;
      if (event.target === svg) {
        try { hit = resolveAnnotationAt(event); } catch { hit = null; }
      }
      if (shouldShowSelectionMoveCursor(event.target, svg, hit, isSelectedHitRef.current)) {
        if (svg.getAttribute(SELECTION_HOVER_ATTR) !== 'move') svg.setAttribute(SELECTION_HOVER_ATTR, 'move');
      } else {
        clear();
      }
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerleave', clear);
    return () => {
      svg.removeEventListener('pointermove', onMove);
      svg.removeEventListener('pointerleave', clear);
      clear();
    };
  }, [enabled, svgRef]);
}
