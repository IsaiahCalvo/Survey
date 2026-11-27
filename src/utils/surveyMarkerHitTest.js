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
import { isInTabBehind } from './tabBehind.js';

function resolveMarkerFromTarget(el) {
  const carrier = el.closest?.('[data-survey-marker-id]');
  const annotationId = carrier?.getAttribute?.('data-survey-marker-id');
  const wrapper = el.closest?.('[data-diag-svg-wrapper]');
  const pageNumber = Number(wrapper?.getAttribute?.('data-diag-svg-wrapper'));
  if (annotationId && Number.isFinite(pageNumber) && pageNumber > 0) {
    return { pageNumber, annotationId, element: carrier };
  }
  return null;
}

function collectMarkerTargets(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  const list = Array.from(root.querySelectorAll('[data-survey-marker-hit-target="true"]'));
  return list.filter((el) => !isInTabBehind(el) && el.closest?.('[data-diag-svg-wrapper]'));
}

export function findSurveyMarkerAt(event, root = typeof document !== 'undefined' ? document : null) {
  if (!event || !root || typeof root.querySelectorAll !== 'function') return null;
  const x = event.clientX;
  const y = event.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const targets = collectMarkerTargets(root).reverse();
  for (const el of targets) {
    if (!targetContainsPoint(el, x, y)) continue;
    const hit = resolveMarkerFromTarget(el);
    if (hit) return hit;
  }
  return null;
}

/**
 * Exact geometry hit first, then nearest marker within touch/mouse slop
 * (16 px touch, 6 px mouse by default — matching #1722/#1762) so Select,
 * Text Select, and Pan taps on or near small/dot Survey Markers select
 * reliably on phone and desktop (#1815).
 */
export function findNearestSurveyMarkerAt(
  event,
  root = typeof document !== 'undefined' ? document : null,
  { touchPad = 16, mousePad = 6 } = {},
) {
  const exact = findSurveyMarkerAt(event, root);
  if (exact) return exact;
  if (!event || !root || typeof root.querySelectorAll !== 'function') return null;
  const x = event.clientX;
  const y = event.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pad = event.pointerType === 'touch' ? touchPad : mousePad;
  if (!(pad > 0)) return null;

  const targets = collectMarkerTargets(root).reverse();
  let best = null;
  let bestDistSq = Infinity;
  for (const el of targets) {
    if (typeof el.getBoundingClientRect !== 'function') continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    const strokeHalf = renderedStrokeHalfPx(el);
    const reach = strokeHalf + pad;
    if (x < r.left - reach || x > r.right + reach || y < r.top - reach || y > r.bottom + reach) {
      continue;
    }
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const dSq = (x - cx) ** 2 + (y - cy) ** 2;
    if (dSq < bestDistSq) {
      const hit = resolveMarkerFromTarget(el);
      if (hit) {
        bestDistSq = dSq;
        best = hit;
      }
    }
  }
  return best;
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

function renderedStrokeHalfPx(el) {
  const strokeWidth = parseFloat(el.getAttribute?.('stroke-width'));
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) return 0;
  const ctm = typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
  if (!ctm) return strokeWidth / 2;
  const scale = Math.max(Math.hypot(ctm.a, ctm.b), Math.hypot(ctm.c, ctm.d));
  return Number.isFinite(scale) ? (strokeWidth * scale) / 2 : 0;
}

function targetContainsPoint(el, x, y) {
  const svg = el.ownerSVGElement;
  const ctm = typeof el.getScreenCTM === 'function' ? el.getScreenCTM() : null;
  if (!svg || !ctm || typeof svg.createSVGPoint !== 'function') return false;
  if (typeof el.getBoundingClientRect === 'function') {
    // A cheap box check first. The box leaves out the stroke, so grow it by
    // the stroke's half width on screen (a dot's centreline box is a hair
    // wide while its paint is the whole width), plus a little.
    const pad = renderedStrokeHalfPx(el) + 4;
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
