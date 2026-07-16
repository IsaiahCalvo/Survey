/**
 * Geometry-based annotation hit source for canvas presentation.
 *
 * Since a3380bbf the SVG annotation layer (and its per-annotation DOM) only
 * mounts under svg-interactive tools (select / text-select / callout / edit).
 * Under every other tool the page shows the LightweightAnnotationOverlay
 * canvas, so DOM-walk hit testing in resolveAnnotationAt finds nothing —
 * which silently killed pan-mode hover/quick-click and the annotation
 * right-click menu under drawing tools.
 *
 * This module restores hit testing WITHOUT remounting any SVG DOM:
 * - LightweightAnnotationOverlay registers a per-page source exposing the
 *   same visible annotation objects (with their ORIGINAL indices — the
 *   contract data-annotation-index / pendingSvgSelection expects) plus the
 *   page's callouts and the on-screen surface element.
 * - resolveAnnotationAt calls resolveGeometryHitAtPagePoint with the cursor
 *   mapped into page space. Pure math over annotation data; runs only on
 *   click / right-click / rAF-throttled hover — zero per-frame cost.
 */

import { isPointOnObject, distanceToLineSegment } from './geometryHitTest.js';
import { toFabricShape } from './svgToFabricShape.js';
import { calculateCalloutConnection } from './calloutGeometry.js';

const sourcesByPage = new Map();

/**
 * @param {number} pageNumber
 * @param {() => ({surfaceEl: Element, pageWidth: number, pageHeight: number,
 *   items: Array<{obj: object, index: number}>, callouts: Array<object>} | null)} sourceFn
 * @returns {() => void} unregister
 */
export function registerAnnotationHitSource(pageNumber, sourceFn) {
  const key = Number(pageNumber);
  sourcesByPage.set(key, sourceFn);
  return () => {
    if (sourcesByPage.get(key) === sourceFn) sourcesByPage.delete(key);
  };
}

export function getAnnotationHitSource(pageNumber) {
  return sourcesByPage.get(Number(pageNumber)) || null;
}

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Point-hit a callout using the SAME geometry the presentation painter draws
 * (annotationCanvasPainter drawCallout): textbox rect + the two connection
 * segments from calculateCalloutConnection. Not the loose bounding box —
 * an L-shaped callout's bbox would swallow clicks on empty page space.
 */
function isPointOnCallout(point, callout, pageWidth, pageHeight, tolerance) {
  const c = callout || {};
  const arrowTip = {
    x: toNumber(c.arrowTip?.x) * pageWidth,
    y: toNumber(c.arrowTip?.y) * pageHeight,
  };
  const knee = {
    x: toNumber(c.knee?.x) * pageWidth,
    y: toNumber(c.knee?.y) * pageHeight,
  };
  const box = {
    x: toNumber(c.textBoxPosition?.x ?? c.textBox?.x) * pageWidth,
    y: toNumber(c.textBoxPosition?.y ?? c.textBox?.y) * pageHeight,
    width: Math.max(1, toNumber(c.textBoxWidth ?? c.textBox?.width) * pageWidth),
    height: Math.max(1, toNumber(c.textBoxHeight ?? c.textBox?.height) * pageHeight),
  };

  if (point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance
    && point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance) {
    return true;
  }

  const lineThickness = Math.max(1, toNumber(c.style?.lineThickness, 2));
  const hitDistance = lineThickness / 2 + tolerance;
  let connection = null;
  try {
    connection = calculateCalloutConnection(
      box.x, box.y, box.width, box.height, knee, arrowTip, lineThickness,
    );
  } catch {
    connection = null;
  }
  if (!connection) return false;

  if (!connection.shouldHideLine1
    && distanceToLineSegment(point, connection.line1Start, connection.effectiveKnee) <= hitDistance) {
    return true;
  }
  return distanceToLineSegment(point, connection.line2Start, arrowTip) <= hitDistance;
}

/**
 * Resolve what sits under a page-space point. Callouts are tested first
 * (the painter draws them on top of annotation objects), then annotation
 * items topmost-first, mirroring visual stacking.
 *
 * @param {{x: number, y: number}} pagePoint - point in page units
 * @param {{pageWidth: number, pageHeight: number,
 *   items: Array<{obj: object, index: number}>, callouts: Array<object>}} data
 * @param {number} tolerance - hit tolerance in page units
 * @returns {{calloutId: string} | {annotationIndex: number} | null}
 */
export function resolveGeometryHitAtPagePoint(pagePoint, data, tolerance) {
  if (!pagePoint || !data) return null;
  const pageWidth = toNumber(data.pageWidth);
  const pageHeight = toNumber(data.pageHeight);
  if (pageWidth <= 0 || pageHeight <= 0) return null;

  const callouts = Array.isArray(data.callouts) ? data.callouts : [];
  for (let i = callouts.length - 1; i >= 0; i--) {
    const callout = callouts[i];
    if (!callout || callout.id == null) continue;
    if (isPointOnCallout(pagePoint, callout, pageWidth, pageHeight, tolerance)) {
      return { calloutId: String(callout.id) };
    }
  }

  const items = Array.isArray(data.items) ? data.items : [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!item || !item.obj || !Number.isFinite(Number(item.index))) continue;
    let hit = false;
    try {
      hit = isPointOnObject(pagePoint, toFabricShape(item.obj), tolerance);
    } catch {
      hit = false;
    }
    if (hit) return { annotationIndex: Number(item.index) };
  }

  return null;
}
