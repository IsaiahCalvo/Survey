/**
 * toolPressRouting — the DOM half of the Drawboard press rules (owner
 * 2026-10-02). utils/selectModes.js decides WHAT a press does; this file only
 * finds out what the press landed on and hands that to the rule table, so the
 * SVG layer and the Text / Counter overlays ask one question the same way.
 */
import { resolveAnnotationAt } from './annotationHitTest.js';
import { resolveToolPress } from './selectModes.js';

/** Text boxes (and callouts, handled by id) open an editor on rule 6 / 7. */
export function isTextLikeAnnotation(obj) {
  const type = String(obj?.type || '').toLowerCase();
  return type === 'textbox' || type === 'i-text' || type === 'text';
}

const idSetHas = (ids, id) => {
  if (id == null || !ids) return false;
  if (ids instanceof Set) return ids.has(id) || ids.has(String(id));
  return Array.isArray(ids) && (ids.includes(id) || ids.includes(String(id)));
};

/** True when one of the selected callouts lives on this page. */
export function isPageCalloutSelected(callouts, selectedCalloutIds, pageNumber) {
  const size = selectedCalloutIds instanceof Set ? selectedCalloutIds.size
    : (Array.isArray(selectedCalloutIds) ? selectedCalloutIds.length : 0);
  if (!size || !Array.isArray(callouts)) return false;
  return callouts.some((c) => c && c.pageNumber === pageNumber && idSetHas(selectedCalloutIds, c.id));
}

/**
 * What a press on a page landed on, by geometry (the same hit test Pan and the
 * right-click menu use, so it works while the marks are pointer-inert).
 * Returns { target: 'text' | 'mark' | 'empty', index, calloutId }.
 */
export function classifyPagePress(nativeEvent, { pageNumber, objects } = {}) {
  let hit = null;
  try { hit = resolveAnnotationAt(nativeEvent); } catch (_) { hit = null; }
  const onPage = hit && (pageNumber == null || hit.pageNumber === pageNumber);
  if (onPage && hit.kind === 'callout' && hit.calloutId != null) {
    return { target: 'text', index: null, calloutId: hit.calloutId, pageNumber: hit.pageNumber };
  }
  if (onPage && hit.kind === 'annotation' && Number.isInteger(hit.annotationIndex)) {
    const obj = Array.isArray(objects) ? objects[hit.annotationIndex] : null;
    return {
      target: isTextLikeAnnotation(obj) ? 'text' : 'mark',
      index: hit.annotationIndex,
      calloutId: null,
      pageNumber: hit.pageNumber,
    };
  }
  return { target: 'empty', index: null, calloutId: null, pageNumber: hit?.pageNumber ?? pageNumber ?? null };
}

/** classifyPagePress + the rule table in one call. */
export function resolvePagePress(nativeEvent, { tool, pageNumber, objects, hasSelection }) {
  const where = classifyPagePress(nativeEvent, { pageNumber, objects });
  const press = resolveToolPress({ tool, target: where.target, hasSelection, shiftKey: !!nativeEvent?.shiftKey });
  return { ...where, ...press };
}

/**
 * Is `el` (what the browser finds under the pointer with the layer armed)
 * part of the current selection? Returns null, or
 * { key, text, index, calloutId, el } — `text` when a double press on it
 * should open its editor (rule 7).
 */
export function classifySelectionGrabTarget(el, svg, { selectedIds, selectedCalloutIds, selectedMarkerIds, objects } = {}) {
  if (!el || !svg || !svg.contains(el)) return null;
  if (el.closest('[data-resize-handle], [data-handle-hit-pad], [data-rotation-handle], [data-text-range-handle-hit-target]')) {
    return { key: 'handle', text: false, index: null, calloutId: null, el };
  }
  const callout = el.closest('[data-callout-id]');
  if (callout) {
    const id = callout.getAttribute('data-callout-id');
    return idSetHas(selectedCalloutIds, id) ? { key: `c:${id}`, text: true, index: null, calloutId: id, el } : null;
  }
  const marker = el.closest('[data-survey-marker-id]');
  if (marker) {
    const id = marker.getAttribute('data-survey-marker-id');
    return idSetHas(selectedMarkerIds, id) ? { key: `m:${id}`, text: false, index: null, calloutId: null, el } : null;
  }
  const wrap = el.closest('[data-annotation-index]');
  if (wrap) {
    const index = Number(wrap.getAttribute('data-annotation-index'));
    if (Number.isInteger(index) && idSetHas(selectedIds, index)) {
      const obj = Array.isArray(objects) ? objects[index] : null;
      return { key: `a:${index}`, text: isTextLikeAnnotation(obj), index, calloutId: null, el };
    }
  }
  return null;
}
