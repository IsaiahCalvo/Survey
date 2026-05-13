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
// Phase 35 Plan 03 — owner-aware post-filter on marquee hit-test results.
// Pulled from the single permission-scope source of truth so the marquee
// uses the same canModify chain as click hit-test, eraser hit-test, and
// the bulk-delete planner. No per-call-site fallback drift.
import { canModify, getAnnotationAuthorId, isOwner } from '../lib/collab/permissionScope.js';
// Phase 35 — UAT diagnostic logger. Dev-only, production-stripped.
import { phase35Diag } from '../lib/collab/phase35Diag.js';

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
      if (isBBoxFullyContained(marqueeRect, bbox)) {
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

/**
 * Phase 35 Plan 03 — owner-aware post-filter wrapping resolveMarqueeHits.
 *
 * Drops foreign-author hits from the marquee result when the viewer is a
 * collaborator. Owner-mode is a same-reference passthrough: when every hit
 * passes canModify (which is unconditionally true for the document owner),
 * the input array reference is returned unchanged. UX-comment-grade decision —
 * this preserves React reference-equality memoization downstream so the
 * SVG-layer hot path doesn't re-render every annotation on every pointermove
 * while a marquee is tracking. Boot-guard (missing viewerId / documentOwnerId)
 * also returns the input reference unchanged so legacy mount sites that
 * haven't yet threaded the new props behave identically to today.
 *
 * AC mapping (CONTEXT.md): Acceptance Criterion #1 — "non-owner marquee
 * across mixed-author content only catches own annotations".
 *
 * @param {Array<number>} hitIndices  result of resolveMarqueeHits
 * @param {{ objects: Array<object> } | undefined} annotations  Fabric JSON
 * @param {string|null|undefined} viewerId
 * @param {string|null|undefined} documentOwnerId
 * @returns {Array<number>}  owner-mode: same reference; collab-mode: filtered new array
 */
export function filterMarqueeHits(hitIndices, annotations, viewerId, documentOwnerId) {
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
  if (!viewerId || !documentOwnerId) {
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
    const ok = canModify({ annotation: a, viewerId, documentOwnerId });
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
  // Owner-mode (or all-own collab session): everything passed → return same
  // reference for React memoization. canModify short-circuits to true for the
  // owner regardless of authorId, so this branch is the owner hot path.
  if (allOwn && filtered.length === hitIndices.length) return hitIndices;
  return filtered;
}
