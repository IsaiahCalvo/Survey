/**
 * Phase 19 — AutoCAD Window + Crossing Selection
 *
 * Pure marquee math. No React, no DOM, no mutation.
 *
 *   - getMarqueeDirection({ startX, endX })
 *       left-to-right (endX >= startX) = 'window'  (solid blue, full containment)
 *       right-to-left (endX  < startX) = 'crossing' (dashed green, intersect)
 *
 *   - getMarqueeRect({ startX, startY, endX, endY })
 *       Normalized { left, top, right, bottom, width, height } — independent
 *       of drag direction.
 *
 *   - isBBoxFullyContained(marquee, bbox)
 *       Every edge of bbox is inside marquee.
 *
 *   - isBBoxOverlapping(marquee, bbox)
 *       Standard AABB overlap. False when strictly disjoint.
 *
 *   - resolveMarqueeHits({ marqueeRect, direction, annotations, callouts, pageWidth, pageHeight })
 *       Dispatches by direction:
 *         window   → bbox fully inside marquee (cheap, no geometry probe)
 *         crossing → bbox overlap fast-reject, then doesRectIntersectObject
 *                    via the SVG-to-Fabric adapter.
 *
 * Min-drag threshold of 5 px and visual constants match the dormant reference
 * at PageAnnotationLayer.jsx:7411-7854 exactly.
 */

import { getAnnotationBBox } from './svgBoundingBox.js';
import { doesRectIntersectObject } from './geometryHitTest.js';
import { toFabricShape } from './svgToFabricShape.js';

export const MIN_DRAG_PX = 5;

export function getMarqueeDirection({ startX, endX }) {
  return endX >= startX ? 'window' : 'crossing';
}

export function getMarqueeRect({ startX, startY, endX, endY }) {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const top = Math.min(startY, endY);
  const bottom = Math.max(startY, endY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function isBBoxFullyContained(marquee, bbox) {
  return (
    bbox.left >= marquee.left &&
    bbox.right <= marquee.right &&
    bbox.top >= marquee.top &&
    bbox.bottom <= marquee.bottom
  );
}

export function isBBoxOverlapping(marquee, bbox) {
  return !(
    bbox.right < marquee.left ||
    bbox.left > marquee.right ||
    bbox.bottom < marquee.top ||
    bbox.top > marquee.bottom
  );
}

function bboxFromAnnotation(obj) {
  try {
    const b = getAnnotationBBox(obj);
    if (!b) return null;
    return {
      left: b.left,
      top: b.top,
      right: b.left + b.width,
      bottom: b.top + b.height,
    };
  } catch (_) {
    return null;
  }
}

function bboxFromCallout(callout, pageWidth, pageHeight) {
  const xs = [
    callout.arrowTip?.x ?? 0,
    callout.knee?.x ?? 0,
    callout.textBoxPosition?.x ?? 0,
    (callout.textBoxPosition?.x ?? 0) + (callout.textBoxWidth ?? 0),
  ].map((n) => n * (pageWidth || 0));
  const ys = [
    callout.arrowTip?.y ?? 0,
    callout.knee?.y ?? 0,
    callout.textBoxPosition?.y ?? 0,
    (callout.textBoxPosition?.y ?? 0) + (callout.textBoxHeight ?? 0),
  ].map((n) => n * (pageHeight || 0));
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

export function resolveMarqueeHits({
  marqueeRect,
  direction,
  annotations,
  callouts,
  pageWidth,
  pageHeight,
}) {
  const annotationIndices = [];
  const calloutIds = [];

  const objects = annotations?.objects || [];
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || !obj.type) continue;
    const bbox = bboxFromAnnotation(obj);
    if (!bbox) continue;

    if (direction === 'window') {
      if (isBBoxFullyContained(marqueeRect, bbox)) {
        annotationIndices.push(i);
      }
    } else {
      if (!isBBoxOverlapping(marqueeRect, bbox)) continue;
      const shape = toFabricShape(obj);
      if (doesRectIntersectObject(marqueeRect, shape)) {
        annotationIndices.push(i);
      }
    }
  }

  const calloutArr = Array.isArray(callouts) ? callouts : [];
  for (const callout of calloutArr) {
    if (!callout || !callout.id) continue;
    const bbox = bboxFromCallout(callout, pageWidth, pageHeight);

    if (direction === 'window') {
      if (isBBoxFullyContained(marqueeRect, bbox)) {
        calloutIds.push(callout.id);
      }
    } else {
      if (!isBBoxOverlapping(marqueeRect, bbox)) continue;
      const shape = toFabricShape(callout, { pageWidth, pageHeight, kind: 'callout' });
      if (doesRectIntersectObject(marqueeRect, shape)) {
        calloutIds.push(callout.id);
      }
    }
  }

  return { annotationIndices, calloutIds };
}
