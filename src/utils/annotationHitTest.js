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
  // 2026-04-25 — Track the EXACT pageDiv element the click traversed
  // through (not just the page number). The Syncfusion sidebar
  // thumbnails share the same `_pageDiv_N` id pattern as the main
  // viewer pages, so re-querying by id later picks up the wrong
  // element. Saving the actual hit element keeps subsequent
  // page-bounds checks aimed at the page the user clicked on.
  let matchedPageDiv = null;
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
      if (m) {
        pageNumber = Number(m[1]) + 1; // Syncfusion is 0-indexed
        matchedPageDiv = el;
      }
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

  // 2026-04-25 — Reject pageNumber matches that came purely from a
  // Syncfusion `_pageDiv_N` id when the cursor isn't actually within
  // the rendered page rectangle. Since each of Syncfusion's inner
  // elements (page-canvas, annotation-canvas, text-layer) may all
  // extend past the visible page (CSS-stretched to the full
  // container), we can't trust class-based hit-testing alone. Use
  // the actual drawing-buffer dimensions of the page-canvas (the
  // canvas `width`/`height` attributes set by Syncfusion to the
  // rendered page size in pixels) and check the cursor's offset
  // within the canvas.
  if (pageNumber != null && annotationIndex == null && !calloutId && !isCounter) {
    const camePurelyFromPageDiv = !path.some((el) =>
      el && el.getAttribute && (
        el.getAttribute('data-pal-root') != null
        || el.getAttribute('data-diag-svg-wrapper') != null
      )
    );
    if (camePurelyFromPageDiv) {
      const sfIndex = pageNumber - 1;
      // 2026-04-25 — Use the EXACT pageDiv the click hit (saved during
      // path walking). Sidebar thumbnails share the same id pattern,
      // so document.querySelector returns the wrong element about half
      // the time. matchedPageDiv is guaranteed to be the one under
      // the cursor.
      const pageDiv = matchedPageDiv
        || document.querySelector(`[id$="_pageDiv_${sfIndex}"]`);
      const pageCanvas = pageDiv?.querySelector('canvas.e-pv-page-canvas')
        || pageDiv?.querySelector('.e-pv-page-canvas')
        || null;
      // Diagnostic — emit the rects we used so the next save-log can
      // be inspected directly. This is the data needed to confirm
      // whether the page-canvas rect is actually page-sized or
      // container-wide.
      // 2026-04-29: silenced — fires on every mouse move. Re-enable per session
      // by setting window.__DIAG_HIT_TEST = true in DevTools.
      if (typeof window !== 'undefined' && window.__DIAG_HIT_TEST) {
        try {
          const pdRect = pageDiv?.getBoundingClientRect();
          const pcRect = pageCanvas?.getBoundingClientRect();
          console.log(`[HitTest pageDiv-bounds] sfIndex=${sfIndex} cursor=(${Math.round(e.clientX)},${Math.round(e.clientY)}) pageDiv=${pdRect ? JSON.stringify({l:Math.round(pdRect.left), t:Math.round(pdRect.top), r:Math.round(pdRect.right), b:Math.round(pdRect.bottom), w:Math.round(pdRect.width), h:Math.round(pdRect.height)}) : 'null'} pageCanvas=${pcRect ? JSON.stringify({l:Math.round(pcRect.left), t:Math.round(pcRect.top), r:Math.round(pcRect.right), b:Math.round(pcRect.bottom), w:Math.round(pcRect.width), h:Math.round(pcRect.height)}) : 'null'} canvasIntrinsic=${pageCanvas ? `${pageCanvas.width}x${pageCanvas.height}` : 'n/a'}`);
        } catch { /* ignore */ }
      }
      // 2026-04-25 — Two reference rects we can use for the page bounds:
      // (1) the inner page-canvas's CSS rect, and (2) the pageDiv's own
      // bounding rect. The canvas rect is more accurate (it's exactly
      // the rendered PDF surface) BUT some Syncfusion configurations
      // collapse the canvas to zero CSS size while keeping its
      // intrinsic drawing buffer. When that happens, the pageDiv rect
      // is the next-best truth: the pageDiv visually wraps the page
      // exactly in continuous mode at most zooms. Fall back accordingly.
      let insidePage = false;
      const canvasRect = pageCanvas?.getBoundingClientRect();
      const canvasUsable = canvasRect && canvasRect.width > 0 && canvasRect.height > 0;
      const refRect = canvasUsable ? canvasRect : pageDiv?.getBoundingClientRect();
      if (refRect && refRect.width > 0 && refRect.height > 0) {
        insidePage = e.clientX >= refRect.left && e.clientX <= refRect.right
          && e.clientY >= refRect.top && e.clientY <= refRect.bottom;
        // 2026-04-29: silenced — see HitTest pageDiv-bounds note above.
        if (typeof window !== 'undefined' && window.__DIAG_HIT_TEST) {
          try {
            console.log(`[HitTest ref-rect] usingCanvas=${canvasUsable} ref=(${Math.round(refRect.left)},${Math.round(refRect.top)})-(${Math.round(refRect.right)},${Math.round(refRect.bottom)}) inside=${insidePage}`);
          } catch { /* ignore */ }
        }
      }
      if (!insidePage) {
        pageNumber = null;
      }
    }
  }

  const isVisibleElement = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return true;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };

  const rectContainsPoint = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0
      && e.clientX >= r.left && e.clientX <= r.right
      && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  const svgGeometryContainsPoint = (el) => {
    if (!el || !el.ownerSVGElement || typeof el.ownerSVGElement.createSVGPoint !== 'function') {
      return false;
    }
    const ctm = typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
    if (!ctm) return false;
    try {
      const pt = el.ownerSVGElement.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const local = pt.matrixTransform(ctm.inverse());
      if (typeof el.isPointInStroke === 'function' && el.isPointInStroke(local)) return true;
      if (typeof el.isPointInFill === 'function' && el.isPointInFill(local)) return true;
    } catch {
      return false;
    }
    return false;
  };

  const readHitCarrier = (el) => {
    if (!el) return;
    const carrier = el.closest?.('[data-annotation-index], [data-callout-id], [data-counter-overlay]') || el;
    readFrom(carrier);
  };

  // Pan-mode fallback: SVG layer is pointer-events:none, so walk the DOM
  // children of every visible page SVG wrapper. Path hit targets are tested
  // by SVG stroke geometry first, which matches the same widened invisible
  // target the select tool uses.
  if (pageNumber != null && annotationIndex == null && !calloutId && !isCounter) {
    const wrappers = Array.from(document.querySelectorAll(`[data-diag-svg-wrapper="${pageNumber}"]`))
      .filter(isVisibleElement);
    let inspected = 0;
    for (const wrapper of wrappers) {
      const pathTargets = wrapper.querySelectorAll('[data-path-hit-target="true"], [data-path-bbox-hit-target="true"]');
      for (const el of pathTargets) {
        inspected += 1;
        const hit = svgGeometryContainsPoint(el) || rectContainsPoint(el);
        if (!hit) continue;
        readHitCarrier(el);
        if (annotationIndex != null || calloutId || isCounter) break;
      }
      if (annotationIndex != null || calloutId || isCounter) break;

      const candidates = wrapper.querySelectorAll('[data-annotation-index], [data-callout-id], [data-counter-overlay]');
      for (const el of candidates) {
        inspected += 1;
        if (!rectContainsPoint(el)) continue;
        readFrom(el);
        if (annotationIndex != null || calloutId || isCounter) break;
      }
      if (annotationIndex != null || calloutId || isCounter) break;
    }
    if (typeof window !== 'undefined' && window.__DIAG_HIT_TEST) {
      try {
        console.log(`[HitTest pan-svg-fallback] page=${pageNumber} wrappers=${wrappers.length} inspected=${inspected} result=${annotationIndex != null ? `annotation:${annotationIndex}` : calloutId ? `callout:${calloutId}` : isCounter ? 'counter' : 'none'} cursor=(${Math.round(e.clientX)},${Math.round(e.clientY)})`);
      } catch {
        /* ignore */
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
