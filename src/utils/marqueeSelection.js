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

import { getAnnotationBBox, getAnnotationWorldAABB } from './svgBoundingBox.js';
import { doesRectIntersectObject, isObjectFullyInRect } from './geometryHitTest.js';
import { toFabricShape } from './svgToFabricShape.js';
// Phase 35 Plan 03 — post-filter on marquee hit-test results. Pulled from
// the single permission-scope source of truth so the marquee uses the same
// canDelete chain as the click hit-test gate and the bulk-delete planner
// (locked model 2026-07-17: contributors select everyone's marks; the
// eraser deliberately stays on canModify — see FabricEraserCanvas).
import { canDelete, getAnnotationAuthorId, isOwner } from '../lib/collab/permissionScope.js';
// Phase 35 — UAT diagnostic logger. Dev-only, production-stripped.
import { phase35Diag } from '../lib/collab/phase35Diag.js';

export const MIN_DRAG_PX = 5;

export function getMarqueeDirection({ startX, endX, modeOverride }) {
  if (modeOverride === 'window' || modeOverride === 'crossing') return modeOverride;
  return endX >= startX ? 'window' : 'crossing';
}

export function cycleMarqueeDirection(direction) {
  return direction === 'window' ? 'crossing' : 'window';
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
    const b = getAnnotationWorldAABB(obj);
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

function denormalizeCalloutPoint(point, pageWidth, pageHeight) {
  return {
    x: (point?.x ?? 0) * (pageWidth || 0),
    y: (point?.y ?? 0) * (pageHeight || 0),
  };
}

function getCalloutGeometry(callout, pageWidth, pageHeight) {
  const arrowTip = denormalizeCalloutPoint(callout.arrowTip, pageWidth, pageHeight);
  const knee = denormalizeCalloutPoint(callout.knee, pageWidth, pageHeight);
  const textLeft = (callout.textBoxPosition?.x ?? 0) * (pageWidth || 0);
  const textTop = (callout.textBoxPosition?.y ?? 0) * (pageHeight || 0);
  const textWidth = (callout.textBoxWidth ?? 0) * (pageWidth || 0);
  const textHeight = (callout.textBoxHeight ?? 0) * (pageHeight || 0);
  const textCenter = { x: textLeft + textWidth / 2, y: textTop + textHeight / 2 };
  const strokeWidth = Math.max(1, Number(callout.style?.lineThickness || callout.lineThickness || 2));
  return {
    arrowTip,
    knee,
    textCenter,
    textRect: {
      type: 'rect',
      left: textLeft,
      top: textTop,
      width: textWidth,
      height: textHeight,
      fill: 'rgba(0,0,0,0.001)',
      stroke: callout.style?.borderColor || callout.borderColor || 'transparent',
      strokeWidth,
    },
    segments: [
      { type: 'line', x1: arrowTip.x, y1: arrowTip.y, x2: knee.x, y2: knee.y, stroke: '#000', strokeWidth },
      { type: 'line', x1: knee.x, y1: knee.y, x2: textCenter.x, y2: textCenter.y, stroke: '#000', strokeWidth },
    ],
  };
}

function isPointInMarquee(point, marqueeRect) {
  return point.x >= marqueeRect.left &&
    point.x <= marqueeRect.right &&
    point.y >= marqueeRect.top &&
    point.y <= marqueeRect.bottom;
}

function isCalloutFullyInRect(marqueeRect, callout, pageWidth, pageHeight) {
  const geom = getCalloutGeometry(callout, pageWidth, pageHeight);
  const r = geom.textRect;
  const textCorners = [
    { x: r.left, y: r.top },
    { x: r.left + r.width, y: r.top },
    { x: r.left + r.width, y: r.top + r.height },
    { x: r.left, y: r.top + r.height },
  ];
  return [geom.arrowTip, geom.knee, geom.textCenter, ...textCorners]
    .every((point) => isPointInMarquee(point, marqueeRect));
}

function doesRectIntersectCallout(marqueeRect, callout, pageWidth, pageHeight) {
  const geom = getCalloutGeometry(callout, pageWidth, pageHeight);
  if (doesRectIntersectObject(marqueeRect, geom.textRect)) return true;
  return geom.segments.some((segment) => doesRectIntersectObject(marqueeRect, segment));
}

export function resolveMarqueeHits({
  marqueeRect,
  direction,
  annotations,
  callouts,
  pageWidth,
  pageHeight,
  pageNumber,
  selectableAnnotationIndices,
  onCandidateDiagnostic,
}) {
  const annotationIndices = [];
  const calloutIds = [];
  const selectableSet = selectableAnnotationIndices instanceof Set
    ? selectableAnnotationIndices
    : Array.isArray(selectableAnnotationIndices)
      ? new Set(selectableAnnotationIndices)
      : null;

  const emitDiag = (entry) => {
    if (typeof onCandidateDiagnostic === 'function') {
      try { onCandidateDiagnostic(entry); } catch (_) {}
    }
  };

  const objects = annotations?.objects || [];
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (!obj || !obj.type) {
      emitDiag({ index: i, included: false, reason: 'missing-object-or-type', obj });
      continue;
    }
    if (selectableSet && !selectableSet.has(i)) {
      emitDiag({ index: i, included: false, reason: 'not-rendered-or-not-interactive', obj });
      continue;
    }
    const bbox = bboxFromAnnotation(obj);
    if (!bbox) {
      emitDiag({ index: i, included: false, reason: 'missing-bbox', obj });
      continue;
    }

    if (direction === 'window') {
      const shape = toFabricShape(obj);
      if (isObjectFullyInRect(marqueeRect, shape)) {
        emitDiag({ index: i, included: true, reason: 'window-contained', bbox, obj });
        annotationIndices.push(i);
      } else {
        emitDiag({ index: i, included: false, reason: 'window-not-contained', bbox, obj });
      }
    } else {
      if (!isBBoxOverlapping(marqueeRect, bbox)) {
        emitDiag({ index: i, included: false, reason: 'crossing-bbox-miss', bbox, obj });
        continue;
      }
      if (obj?.data?.type === 'text-markup') {
        const quadHit = (obj.data.quads || []).some((quad) => {
          const quadBox = {
            left: Math.min(Number(quad.x1), Number(quad.x2), Number(quad.x3), Number(quad.x4)),
            right: Math.max(Number(quad.x1), Number(quad.x2), Number(quad.x3), Number(quad.x4)),
            top: Math.min(Number(quad.y1), Number(quad.y2), Number(quad.y3), Number(quad.y4)),
            bottom: Math.max(Number(quad.y1), Number(quad.y2), Number(quad.y3), Number(quad.y4)),
          };
          return isBBoxOverlapping(marqueeRect, quadBox);
        });
        if (quadHit) {
          emitDiag({ index: i, included: true, reason: 'crossing-text-range-hit', bbox, obj });
          annotationIndices.push(i);
          continue;
        }
      }
      const shape = toFabricShape(obj);
      if (doesRectIntersectObject(marqueeRect, shape)) {
        emitDiag({ index: i, included: true, reason: 'crossing-geometry-hit', bbox, obj });
        annotationIndices.push(i);
      } else {
        emitDiag({ index: i, included: false, reason: 'crossing-geometry-miss', bbox, obj });
      }
    }
  }

  const calloutArr = Array.isArray(callouts) ? callouts : [];
  for (const callout of calloutArr) {
    if (!callout || !callout.id) continue;
    if (
      pageNumber != null &&
      callout.pageNumber != null &&
      Number(callout.pageNumber) !== Number(pageNumber)
    ) {
      continue;
    }
    const bbox = bboxFromCallout(callout, pageWidth, pageHeight);

    if (direction === 'window') {
      if (isCalloutFullyInRect(marqueeRect, callout, pageWidth, pageHeight)) {
        calloutIds.push(callout.id);
      }
    } else {
      if (!isBBoxOverlapping(marqueeRect, bbox)) continue;
      if (doesRectIntersectCallout(marqueeRect, callout, pageWidth, pageHeight)) {
        calloutIds.push(callout.id);
      }
    }
  }

  return { annotationIndices, calloutIds };
}

/**
 * Phase 35 Plan 03 — post-filter wrapping resolveMarqueeHits, updated
 * 2026-07-17 for the LOCKED permissions model (contributors and owners have
 * full add/edit/delete on everything; viewers look-only). The filter now runs
 * canDelete — any authenticated write-capable session keeps ALL hits,
 * including foreign-author marks, so a contributor's marquee selects other
 * users' shapes exactly like the owner's does. Cross-author DELETES of that
 * selection still always confirm: useSVGInteraction.deleteSelected routes
 * foreign ids through the bulk-delete planner's collaborator-cross-author
 * modal and never direct-fires them. Viewers never marquee at all
 * (ReadOnlyGate blocks pointer events at the SVG root).
 *
 * All-pass results return the input array reference unchanged (owner AND
 * contributor hot paths) to preserve React reference-equality memoization
 * downstream. Boot-guard (missing viewerId / documentOwnerId) also returns
 * the input reference unchanged so legacy mount sites that haven't yet
 * threaded the new props behave identically to today. Missing objects
 * (stale indices) still drop.
 *
 * @param {Array<number>} hitIndices  result of resolveMarqueeHits
 * @param {{ objects: Array<object> } | undefined} annotations  Fabric JSON
 * @param {string|null|undefined} viewerId
 * @param {string|null|undefined} documentOwnerId
 * @returns {Array<number>}  owner-mode: same reference; collab-mode: filtered new array
 */
export function filterMarqueeHits(hitIndices, annotations, viewerId, documentOwnerId, localDocumentContext) {
  if (!Array.isArray(hitIndices) || hitIndices.length === 0) {
    // Phase 35 UAT diag — empty marquee result. Common when drag is below
    // MIN_DRAG_PX or hits no geometry; helpful to see ownership props anyway.
    phase35Diag('marquee.filter', {
      stage: 'empty-or-noop',
      viewerId,
      documentOwnerId,
      hitsIn: hitIndices?.length ?? 0,
      hitsOut: hitIndices?.length ?? 0,
    });
    return hitIndices;
  }
  // Boot guard — props not yet resolved at the mount site. Return same ref so
  // legacy behavior is byte-identical.
  if ((!viewerId || !documentOwnerId) && localDocumentContext == null) {
    phase35Diag('marquee.filter', {
      stage: 'boot-guard-passthrough',
      viewerId,
      documentOwnerId,
      hitsIn: hitIndices.length,
      hitsOut: hitIndices.length,
      note: 'viewerId or documentOwnerId missing — returning input ref unchanged',
    });
    return hitIndices;
  }
  const objects = annotations?.objects || [];
  let allOwn = true;
  // Per-annotation decision trace — used by Phase 35 UAT diag below.
  const perAnnotation = [];
  const filtered = hitIndices.filter((i) => {
    const a = objects[i];
    if (!a) {
      perAnnotation.push({ index: i, present: false, decision: 'DENY-MISSING' });
      allOwn = false;
      return false;
    }
    // Locked model 2026-07-17: canDelete (authenticated pair ⇒ allow, any
    // author) replaces canModify so contributors marquee foreign shapes too.
    const ok = canDelete({ annotation: a, viewerId, documentOwnerId, localDocumentContext });
    if (!ok) allOwn = false;
    perAnnotation.push({
      index: i,
      present: true,
      annotationId: a?.data?.fabricId ?? a?.id ?? null,
      authorId: getAnnotationAuthorId(a),
      type: a?.type ?? null,
      decision: ok ? 'ALLOW' : 'DENY-FOREIGN',
    });
    return ok;
  });
  // Phase 35 UAT diag — full marquee filter trace. Per project feedback, dump
  // every per-annotation decision so a single console paste contains the full
  // proof of the gate's behavior.
  phase35Diag('marquee.filter', {
    stage: 'filtered',
    viewerId,
    documentOwnerId,
    role: isOwner(viewerId, documentOwnerId) ? 'owner' : 'collaborator',
    hitsIn: hitIndices.length,
    hitsOut: filtered.length,
    droppedCount: hitIndices.length - filtered.length,
    perAnnotation,
    sameRefReturned: allOwn && filtered.length === hitIndices.length,
  });
  // Everything passed → return same reference for React memoization. With
  // canDelete this is the hot path for owners AND contributors alike.
  if (allOwn && filtered.length === hitIndices.length) return hitIndices;
  return filtered;
}
