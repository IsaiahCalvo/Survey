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
 * Returns { pageNumber, annotationId } or null.
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
    if (annotationId && Number.isFinite(pageNumber) && pageNumber > 0) return { pageNumber, annotationId };
  }
  return null;
}

function targetContainsPoint(el, x, y) {
  if (typeof el.getBoundingClientRect === 'function') {
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 || r.height > 0)) return false;
    // A freehand stroke's box leaves out half its width; give it room.
    const pad = Math.max(r.width, r.height) * 0.5 + 24;
    if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) return false;
  }
  const svg = el.ownerSVGElement;
  const ctm = typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
  if (!svg || !ctm || typeof svg.createSVGPoint !== 'function') return false;
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
