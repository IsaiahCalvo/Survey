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
 *
 * Historical context only: `codex/preserve-canvas-hit-testing-20260716`
 * preserves the older, pre-unified-renderer geometry-map approach. If click,
 * hover, or right-click behavior regresses, inspect it for ideas and prior
 * reasoning—but do not treat it as a rollback target or cherry-pick it whole.
 * The unified SVG renderer remains the intended architecture.
 */

export function resolveAnnotationAt(e) {
  let pageNumber = null;
  let annotationIndex = null;
  let calloutId = null;
  let isCounter = false;
  // 2026-04-25 — Track the EXACT pageDiv element the click traversed
  // through (not just the page number). The Pdfjs sidebar
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
        pageNumber = Number(m[1]) + 1; // Pdfjs is 0-indexed
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
  // Pdfjs `_pageDiv_N` id when the cursor isn't actually within
  // the rendered page rectangle. Since each of Pdfjs's inner
  // elements (page-canvas, annotation-canvas, text-layer) may all
  // extend past the visible page (CSS-stretched to the full
  // container), we can't trust class-based hit-testing alone. Use
  // the actual drawing-buffer dimensions of the page-canvas (the
  // canvas `width`/`height` attributes set by Pdfjs to the
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
      const pageCanvas = pageDiv?.querySelector('canvas.survey-pdfjs-page-canvas')
        || pageDiv?.querySelector('.survey-pdfjs-page-canvas')
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
      // the rendered PDF surface) BUT some Pdfjs configurations
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
      // Fill counts ONLY when the hit element declares a fill (hit targets
      // signal fill-interactivity via fill="rgba(0,0,0,0.001)" vs "none").
      // Without this gate, isPointInFill would hit the implicit closed
      // interior of unfilled shapes/paths — exactly the bbox-ish behavior
      // the uniform Bluebeam-style model forbids (hollow interiors inert).
      const fillAttr = typeof el.getAttribute === 'function' ? el.getAttribute('fill') : null;
      const fillActive = fillAttr != null && fillAttr !== 'none' && fillAttr !== 'transparent';
      if (fillActive && typeof el.isPointInFill === 'function' && el.isPointInFill(local)) return true;
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

  // Imported links have no painted SVG path. Their transparent HTML region
  // remains a hit-test target even while native text owns pointer events.
  if (pageNumber != null && annotationIndex == null && !calloutId && !isCounter) {
    const page = matchedPageDiv || document.querySelector(`[id$="_pageDiv_${pageNumber - 1}"]`);
    for (const link of page?.querySelectorAll('[data-text-markup-link-index]') || []) {
      if (rectContainsPoint(link)) {
        annotationIndex = Number(link.getAttribute('data-text-markup-link-index'));
        break;
      }
    }
  }

  // Pan-mode fallback: SVG layer is pointer-events:none, so walk the DOM
  // children of every visible page SVG wrapper. Path hit targets are tested
  // by SVG stroke geometry first, which matches the same widened invisible
  // target the select tool uses.
  if (pageNumber != null && annotationIndex == null && !calloutId && !isCounter) {
    const wrappers = Array.from(document.querySelectorAll(`[data-diag-svg-wrapper="${pageNumber}"]`))
      .filter(isVisibleElement);
    let inspected = 0;
    for (const wrapper of wrappers) {
      // Pass 1 — REAL geometry. Every element that traces actual annotation
      // geometry (pen/ink paths + rect/ellipse/polygon/polyline/line/arrow/
      // counter shape targets) is tested with isPointInStroke/isPointInFill
      // only. Deliberately NO bbox fallback: a point inside the bounding box
      // but off the geometry is NOT a hit — hollow shape interiors stay
      // inert in pan/right-click exactly as they are under the Select tool
      // (uniform Bluebeam-style model: edge-only unless filled/text-bearing).
      const geometryTargets = wrapper.querySelectorAll('[data-path-hit-target="true"], [data-shape-hit-target]');
      for (const el of geometryTargets) {
        inspected += 1;
        if (!svgGeometryContainsPoint(el)) continue;
        readHitCarrier(el);
        if (annotationIndex != null || calloutId || isCounter) break;
      }
      if (annotationIndex != null || calloutId || isCounter) break;

      // Pass 2 — intentionally-bbox types only: freetext/textbox fallback
      // rects, survey markers, callout hit zones, counter HTML overlays.
      // Carriers that contain real geometry targets were already decided by
      // pass 1 — skip them so hollow interiors can't resurrect via bbox.
      const candidates = wrapper.querySelectorAll('[data-annotation-index], [data-callout-id], [data-counter-overlay], [data-path-bbox-hit-target="true"]');
      for (const el of candidates) {
        inspected += 1;
        if (typeof el.querySelector === 'function'
          && el.querySelector('[data-path-hit-target="true"], [data-shape-hit-target]')) {
          continue;
        }
        if (!rectContainsPoint(el)) continue;
        readHitCarrier(el);
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
