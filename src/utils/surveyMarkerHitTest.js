/**
 * surveyMarkerHitTest.js — which Survey Marker lies under a pointer event.
 *
 * Owner 2026-10-22: "the pan tool can select basically any annotation but
 * it's not able to select survey markers ... They should all be treated as
 * annotations." Under Pan a marker's hit target has pointer-events off (a
 * drag on it must pan), so the browser cannot say what was pressed; this
 * tests each marker's own hit target by its geometry, as
 * annotationHitTest.js does for the other marks. A box marker counts
 * anywhere inside its box; a freehand marker on its stroke; a smart-fill
 * marker inside its outline. The top-most marker wins.
 *
 * Returns { pageNumber, annotationId, element } or null (`element` is the
 * marker's <g>, for markerPaintsAbove).
 */
export function findSurveyMarkerAt(event, root = typeof document !== 'undefined' ? document : null) {
  if (!event || !root || typeof root.querySelectorAll !== 'function') return null;
  const x = event.clientX;
  const y = event.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const targets = Array.from(root.querySelectorAll('[data-diag-svg-wrapper] [data-survey-marker-hit-target="true"]')).reverse();
  for (const el of targets) {
    if (!targetContainsPoint(el, x, y)) continue;
    const carrier = el.closest?.('[data-survey-marker-id]');
    const annotationId = carrier?.getAttribute?.('data-survey-marker-id');
    const wrapper = el.closest?.('[data-diag-svg-wrapper]');
    const pageNumber = Number(wrapper?.getAttribute?.('data-diag-svg-wrapper'));
    if (annotationId && Number.isFinite(pageNumber) && pageNumber > 0) return { pageNumber, annotationId, element: carrier };
  }
  return null;
}

/**
 * Whether a marker found by findSurveyMarkerAt paints above the mark or
 * callout annotationHitTest.resolveAnnotationAt found at the same point.
 * Markers sit in the page's one stack with every other mark
 * (SVGAnnotationLayer stackedMarks), so the later one in the page's SVG is
 * the one on top.
 */
export function markerPaintsAbove(marker, hit) {
  const element = marker?.element;
  if (!element || !hit || hit.pageNumber !== marker.pageNumber) return false;
  const svg = element.ownerSVGElement;
  if (!svg || typeof svg.querySelector !== 'function') return false;
  let other = null;
  if (hit.kind === 'callout' && hit.calloutId != null) {
    other = svg.querySelector(`[data-callout-id="${CSS.escape(String(hit.calloutId))}"]`);
  } else if (hit.kind === 'annotation' && Number.isInteger(hit.annotationIndex)) {
    other = svg.querySelector(`[data-annotation-index="${hit.annotationIndex}"]`);
  }
  if (!other || typeof other.compareDocumentPosition !== 'function') return false;
  // FOLLOWING = 4: the marker comes after the other mark in the page's SVG.
  return Boolean(other.compareDocumentPosition(element) & 4);
}

function targetContainsPoint(el, x, y) {
  const svg = el.ownerSVGElement;
  const ctm = typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
  if (!svg || !ctm || typeof svg.createSVGPoint !== 'function') return false;
  if (typeof el.getBoundingClientRect === 'function') {
    // A cheap box check first. The box leaves out the stroke, so grow it by
    // the stroke's half width on screen (a dot's centreline box is a hair
    // wide while its paint is the whole width), plus a little.
    const strokeWidth = parseFloat(el.getAttribute?.('stroke-width'));
    const scale = Math.max(Math.hypot(ctm.a, ctm.b), Math.hypot(ctm.c, ctm.d));
    const pad = (Number.isFinite(strokeWidth) && Number.isFinite(scale) ? (strokeWidth * scale) / 2 : 0) + 4;
    const r = el.getBoundingClientRect();
    if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) return false;
  }
  try {
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const local = point.matrixTransform(ctm.inverse());
    const fill = el.getAttribute?.('fill');
    if (fill && fill !== 'none' && typeof el.isPointInFill === 'function' && el.isPointInFill(local)) return true;
    const stroke = el.getAttribute?.('stroke');
    if (stroke && stroke !== 'none' && typeof el.isPointInStroke === 'function' && el.isPointInStroke(local)) return true;
  } catch {
    return false;
  }
  return false;
}
