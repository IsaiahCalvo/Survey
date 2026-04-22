/**
 * Annotation hit-test — shared between the right-click dispatcher and
 * the pan-mode quick-click selection code in App.jsx.
 *
 * Given a native mouse/pointer event, walks the event path + elementsFromPoint
 * + (pan-mode fallback) per-page bounding-rect check to resolve the
 * user-intent target. Returns { pageNumber, annotationIndex, calloutId, kind }
 * where kind is 'page' | 'callout' | 'counter' | 'annotation'.
 *
 * Pan-mode fallback: the SVG annotation layer is pointer-events:none in pan
 * mode so elementsFromPoint can't see it. We manually hit-test the SVG
 * annotation elements on the page by bounding rect.
 */

export function resolveAnnotationAt(e) {
  let pageNumber = null;
  let annotationIndex = null;
  let calloutId = null;
  let isCounter = false;
  // UX: Phase 19 follow-up — when the click lands on empty space inside
  // the outer dashed bounding box of a multi-selection, resolve it as
  // a 'group' kind so the right-click menu can batch cut/copy/delete/
  // z-order across every selected annotation at once.
  let groupIndices = null;
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [];

  const readFrom = (el) => {
    if (!el || !el.getAttribute) return;
    if (pageNumber == null) {
      const pr = el.getAttribute('data-pal-root');
      if (pr != null) pageNumber = Number(pr);
    }
    if (pageNumber == null) {
      const dw = el.getAttribute('data-diag-svg-wrapper');
      if (dw != null) pageNumber = Number(dw);
    }
    if (pageNumber == null && el.id) {
      const m = String(el.id).match(/_pageDiv_(\d+)$/);
      if (m) pageNumber = Number(m[1]) + 1; // Syncfusion is 0-indexed
    }
    if (annotationIndex == null) {
      const ai = el.getAttribute('data-annotation-index');
      if (ai != null) {
        const n = Number(ai);
        if (Number.isFinite(n)) annotationIndex = n;
      }
    }
    if (calloutId == null) {
      const cid = el.getAttribute('data-callout-id');
      if (cid != null) calloutId = cid;
    }
    if (!isCounter) {
      if (el.getAttribute('data-counter-overlay') != null) isCounter = true;
    }
  };

  for (const el of path) readFrom(el);

  if (pageNumber == null && typeof document.elementsFromPoint === 'function') {
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    for (const el of stack) {
      readFrom(el);
      if (pageNumber != null) break;
    }
  }

  // Pan-mode fallback: SVG layer is pointer-events:none, so walk the DOM
  // children of the page's SVG wrapper and bounding-rect test each one.
  if (pageNumber != null && annotationIndex == null && !calloutId && !isCounter) {
    const wrapper = document.querySelector(`[data-diag-svg-wrapper="${pageNumber}"]`);
    if (wrapper) {
      const candidates = wrapper.querySelectorAll('[data-annotation-index], [data-callout-id], [data-counter-overlay]');
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0
          && e.clientX >= r.left && e.clientX <= r.right
          && e.clientY >= r.top && e.clientY <= r.bottom) {
          readFrom(el);
          if (annotationIndex != null || calloutId || isCounter) break;
        }
      }
    }
  }

  // Group-selection fallback: when no annotation / callout / counter
  // matched, check whether the click point is inside any page's outer
  // dashed group bounding box. The outer box is pointer-events:none so
  // this direct-DOM lookup is the only way to resolve it.
  if (annotationIndex == null && !calloutId && !isCounter) {
    const groupBoxes = document.querySelectorAll('[data-group-selection-bbox="true"]');
    for (const el of groupBoxes) {
      const hit = el.querySelector('[data-group-selection-hitbox="true"]') || el;
      const r = hit.getBoundingClientRect();
      if (r.width > 0 && r.height > 0
        && e.clientX >= r.left && e.clientX <= r.right
        && e.clientY >= r.top && e.clientY <= r.bottom) {
        // Resolve the page this group lives on by walking up to the
        // SVG wrapper.
        const wrapper = el.closest('[data-diag-svg-wrapper]');
        if (wrapper) {
          pageNumber = Number(wrapper.getAttribute('data-diag-svg-wrapper'));
        }
        const csv = el.getAttribute('data-group-selection-indices') || '';
        groupIndices = csv
          .split(',')
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n));
        if (groupIndices.length >= 2) break;
        groupIndices = null;
      }
    }
  }

  let kind = 'page';
  if (calloutId) kind = 'callout';
  else if (isCounter) kind = 'counter';
  else if (annotationIndex != null) kind = 'annotation';
  else if (groupIndices && groupIndices.length >= 2) kind = 'group';

  return { pageNumber, annotationIndex, calloutId, kind, groupIndices };
}
