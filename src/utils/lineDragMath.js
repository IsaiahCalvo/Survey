/**
 * Line/arrow drag-commit math helpers.
 *
 * Pure-JS — no React, no DOM. Used by useSVGInteraction.js for the
 * 'midpoint' drag mode and for endpoint-drag auto-revert on collinear geometry.
 *
 * Phase 15 contract: LINE-01/02/03 + ARROW-01/02/03.
 */

import { shouldSnapToLinear, getMidpoint, getControlPoint, getPointOnCurve } from './lineGeometry.js';

/**
 * Translate the original midpoint by the drag delta.
 * Retained for edits that move the stored through-point directly.
 *
 * @param {{x:number,y:number}} startSVGPoint - pointer position at drag start
 * @param {{x:number,y:number}} currentSVGPoint - pointer position now
 * @param {{x:number,y:number}} originalMidpoint - midpoint value at drag start
 *   (either data.midpoint if the line was already curved, or the geometric
 *   midpoint if it was straight)
 * @returns {{x:number,y:number}} new absolute midpoint in page coords
 */
export function deriveMidpointFromPointer(startSVGPoint, currentSVGPoint, originalMidpoint) {
  return {
    x: originalMidpoint.x + (currentSVGPoint.x - startSVGPoint.x),
    y: originalMidpoint.y + (currentSVGPoint.y - startSVGPoint.y),
  };
}

/**
 * Check whether an endpoint drag's resulting geometry is collinear enough
 * to auto-revert the line to straight (LINE-03 / ARROW-03 auto-revert rule).
 * Returns true iff the curved midpoint is within `threshold` px of the new
 * straight baseline defined by (newStart, newEnd).
 *
 * @param {{x:number,y:number}|null|undefined} midpoint - current data.midpoint
 *   (undefined / null / false when the line is already straight — caller should
 *   not need to guard on that since this helper returns false in that case).
 * @param {{x:number,y:number}} newStart - new p1 after endpoint drag
 * @param {{x:number,y:number}} newEnd - new p2 after endpoint drag
 * @param {number} [threshold=10] - snap threshold in px
 * @returns {boolean}
 */
export function shouldRevertEndpointCurve(midpoint, newStart, newEnd, threshold = 10) {
  if (!midpoint) return false;
  return shouldSnapToLinear(midpoint, newStart, newEnd, threshold);
}

/**
 * Write data.midpoint onto an already-cloned annotation. Caller is responsible
 * for having deep-cloned the annotation first (the Phase 15 drag commit uses
 * `JSON.parse(JSON.stringify(annotations))` before mutating).
 *
 * Preserves any existing data.* fields (arrowheadStyle, pdfAnnotationId, etc.)
 * by spreading the existing object before assigning the new midpoint.
 *
 * @param {object} annotation - cloned Fabric.Line JSON
 * @param {{x:number,y:number}} midpoint - new midpoint to write
 * @returns {object} the mutated annotation (same reference as input)
 */
export function applyMidpointToAnnotation(annotation, midpoint) {
  annotation.data = {
    ...(annotation.data || {}),
    midpoint: { x: midpoint.x, y: midpoint.y },
  };
  return annotation;
}

/**
 * Remove data.midpoint from an already-cloned annotation (for snap-to-straight).
 * No-op when data.midpoint is absent. Preserves any other data.* fields.
 *
 * @param {object} annotation - cloned Fabric.Line JSON
 * @returns {object} the mutated annotation (same reference as input)
 */
export function clearMidpointFromAnnotation(annotation) {
  if (annotation.data && 'midpoint' in annotation.data) {
    const nextData = { ...annotation.data };
    delete nextData.midpoint;
    annotation.data = nextData;
  }
  return annotation;
}

/**
 * Resolve the midpoint-handle visual position for a given line.
 * Used by SVGAnnotationLayer.jsx to position the 3rd handle <circle>.
 *
 * - Straight (dataMidpoint falsy): geometric midpoint via getMidpoint(start, end).
 * - Curved: the point of maximum curvature, which may sit away from t=0.5
 *   after an off-centre bend. Saved data.midpoint still defines the curve.
 *
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 * @param {{x:number,y:number}|null|undefined} dataMidpoint
 * @returns {{x:number,y:number}}
 */
export function resolveMidpointHandlePosition(start, end, dataMidpoint) {
  if (!dataMidpoint) return getMidpoint(start, end);
  // The sharpest part of a quadratic is where its tangent is shortest.
  // t=0.5 is only the peak for a symmetric bend; an off-centre drag shifts it.
  const control = getControlPoint(start, end, dataMidpoint);
  const vx = control.x - start.x;
  const vy = control.y - start.y;
  const ax = end.x - 2 * control.x + start.x;
  const ay = end.y - 2 * control.y + start.y;
  const denominator = ax * ax + ay * ay;
  const t = denominator > 1e-12 ? Math.max(0, Math.min(1, -(vx * ax + vy * ay) / denominator)) : 0.5;
  return getPointOnCurve(start, end, dataMidpoint, t);
}

/** Solve the stored t=0.5 through-point for a requested curvature peak.
 * An exact endpoint has no interior peak; return the straight through-point. */
export function midpointForCurveHandle(start, end, handle) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const px = handle.x - start.x, py = handle.y - start.y;
  const dd = dx * dx + dy * dy, pd = px * dx + py * dy, pp = px * px + py * py;
  if (dd === 0) return { ...handle };
  if (px * dy - py * dx === 0) return getMidpoint(start, end);
  // At the peak, Q'(t) · Q''(t) = 0. Substituting Q(t)=handle gives
  // dd*t^3 - 3*pd*t^2 + (pd+2*pp)*t - pp = 0, bracketed by [0,1].
  let low = 0, high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const t = (low + high) / 2;
    const value = ((dd * t - 3 * pd) * t + pd + 2 * pp) * t - pp;
    if (value < 0) low = t;
    else high = t;
  }
  const t = (low + high) / 2, denominator = 2 * t * (1 - t);
  if (denominator < 1e-12) return getMidpoint(start, end);
  const control = { x: start.x + (px - t * t * dx) / denominator, y: start.y + (py - t * t * dy) / denominator };
  return { x: (start.x + end.x) / 4 + control.x / 2, y: (start.y + end.y) / 4 + control.y / 2 };
}
