import { annotationToLassoGeometry, calloutToLassoGeometry } from './lassoObjectAdapter.js';
import { boundsOfPoints } from './arrayExtrema.js';
import { getAnnotationGroupId, getCalloutGroupId } from './annotationGroups.js';
import { isBlockedFromAreaSelection } from './annotationSelectionEligibility.js';

const EPSILON = 1e-7;
export const LASSO_SAMPLE_GAP_PX = 4;
export const LASSO_SIMPLIFY_PX = 1.5;

export function getLassoPointerSamples(event) {
  const liveEvent = event?.nativeEvent || event;
  const coalesced = liveEvent?.getCoalescedEvents?.();
  return Array.isArray(coalesced) && coalesced.length > 0
    ? coalesced
    : liveEvent ? [liveEvent] : [];
}

export function getLassoModeFromTrail(points, threshold = 5) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const startX = Number(points[0]?.x);
  if (!Number.isFinite(startX)) return null;
  for (let index = 1; index < points.length; index += 1) {
    const endX = Number(points[index]?.x);
    if (!Number.isFinite(endX) || Math.abs(endX - startX) < threshold) continue;
    return endX >= startX ? 'window' : 'crossing';
  }
  return null;
}

export function cycleLassoMode(mode) {
  return mode === 'window' ? 'crossing' : mode === 'crossing' ? 'fence' : 'window';
}

export function getLassoGestureIntent(event = {}, touchOperation = 'replace', touchMode = null) {
  const usesOnScreenControls = event.pointerType === 'touch' || event.pointerType === 'pen';
  if (usesOnScreenControls) {
    return {
      shiftHeld: touchOperation === 'add',
      altHeld: touchOperation === 'subtract',
      modeOverride: ['window', 'crossing', 'fence'].includes(touchMode) ? touchMode : null,
    };
  }
  return {
    shiftHeld: !!event.shiftKey && !event.altKey,
    altHeld: !!event.altKey,
    modeOverride: null,
  };
}

const samePoint = (a, b) => Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;
const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointOnSegment = (point, start, end) => (
  Math.abs(orientation(start, end, point)) <= EPSILON
  && point.x >= Math.min(start.x, end.x) - EPSILON
  && point.x <= Math.max(start.x, end.x) + EPSILON
  && point.y >= Math.min(start.y, end.y) - EPSILON
  && point.y <= Math.max(start.y, end.y) + EPSILON
);

const segmentsIntersect = (a, b, c, d) => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b)
    || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
};

const properSegmentsCross = (a, b, c, d) => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
};

const distanceToSegment = (point, start, end) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

export function shouldSampleLassoPoint(previous, next, inverseScale = 1, gapPx = LASSO_SAMPLE_GAP_PX) {
  if (!previous || !next) return true;
  const pageGap = Math.max(EPSILON, gapPx * Math.max(EPSILON, Number(inverseScale) || 1));
  return Math.hypot(next.x - previous.x, next.y - previous.y) >= pageGap;
}

export function simplifyLassoPoints(points, tolerance = LASSO_SIMPLIFY_PX) {
  if (!Array.isArray(points) || points.length <= 2) return Array.isArray(points) ? points.slice() : [];
  const first = points[0];
  const last = points[points.length - 1];
  let maxDistance = -1;
  let splitIndex = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitIndex = index;
    }
  }
  if (maxDistance > tolerance && splitIndex > 0) {
    const left = simplifyLassoPoints(points.slice(0, splitIndex + 1), tolerance);
    const right = simplifyLassoPoints(points.slice(splitIndex), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

const polygonSelfIntersects = (polygon) => {
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = i + 1; j < polygon.length; j += 1) {
      if (j === i || j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % polygon.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
};

export function getLassoPolygonValidation(points) {
  if (!Array.isArray(points)) return { polygon: null, issue: 'too-few-points' };
  const polygon = [];
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    if (!polygon.length || !samePoint(polygon.at(-1), point)) polygon.push({ x: point.x, y: point.y });
  }
  if (polygon.length > 1 && samePoint(polygon[0], polygon.at(-1))) polygon.pop();
  if (polygon.length < 3) return { polygon: null, issue: 'too-few-points' };
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const next = polygon[(i + 1) % polygon.length];
    twiceArea += polygon[i].x * next.y - next.x * polygon[i].y;
  }
  const hasTurn = polygon.some((point, index) => (
    Math.abs(orientation(point, polygon[(index + 1) % polygon.length], polygon[(index + 2) % polygon.length])) > EPSILON
  ));
  if (Math.abs(twiceArea) <= EPSILON && !hasTurn) return { polygon: null, issue: 'zero-area' };
  if (polygonSelfIntersects(polygon)) return { polygon: null, issue: 'self-intersection' };
  return { polygon, issue: null };
}

export function normalizeLassoPolygon(points) {
  return getLassoPolygonValidation(points).polygon;
}

export function normalizeLassoTrail(points) {
  if (!Array.isArray(points)) return null;
  const trail = [];
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    if (!trail.length || !samePoint(trail.at(-1), point)) trail.push({ x: point.x, y: point.y });
  }
  return trail.length >= 2 ? trail : null;
}

export function isPointInLasso(point, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    if (pointOnSegment(point, polygon[j], polygon[i])) return true;
    const yiAbove = polygon[i].y > point.y;
    const yjAbove = polygon[j].y > point.y;
    if (yiAbove !== yjAbove) {
      const crossX = (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y)
        / (polygon[j].y - polygon[i].y) + polygon[i].x;
      if (point.x < crossX) inside = !inside;
    }
  }
  return inside;
}

const polygonBounds = (polygon) => {
  // Linear, not a spread: a lasso path is one point per pointer sample and a
  // long drag overflows a spread's argument limit (see arrayExtrema.js).
  const box = boundsOfPoints(polygon);
  if (!box) return { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  return { left: box.minX, right: box.maxX, top: box.minY, bottom: box.maxY };
};

const boundsContain = (outer, inner) => inner.left >= outer.left - EPSILON
  && inner.right <= outer.right + EPSILON
  && inner.top >= outer.top - EPSILON
  && inner.bottom <= outer.bottom + EPSILON;

export function isGeometryFullyInsideLasso(geometry, rawPolygon) {
  const polygon = normalizeLassoPolygon(rawPolygon);
  if (!geometry || !polygon) return false;
  if (!boundsContain(polygonBounds(polygon), geometry.bounds)) return false;
  for (const outline of geometry.outlines || []) {
    if (!outline.length) continue;
    for (const point of outline) {
      if (!isPointInLasso(point, polygon)) return false;
    }
    for (let index = 0; index < outline.length; index += 1) {
      const start = outline[index];
      const end = outline[(index + 1) % outline.length];
      if (outline.length === 1 || samePoint(start, end)) continue;
      for (let edge = 0; edge < polygon.length; edge += 1) {
        if (properSegmentsCross(start, end, polygon[edge], polygon[(edge + 1) % polygon.length])) return false;
      }
    }
  }
  return true;
}

const outlinesIntersectPolygonBoundary = (outlines, polygon) => {
  for (const outline of outlines || []) {
    for (let index = 0; index < outline.length; index += 1) {
      const start = outline[index];
      const end = outline[(index + 1) % outline.length];
      if (outline.length === 1 || samePoint(start, end)) continue;
      for (let edge = 0; edge < polygon.length; edge += 1) {
        if (segmentsIntersect(start, end, polygon[edge], polygon[(edge + 1) % polygon.length])) return true;
      }
    }
  }
  return false;
};

const outlinesIntersectOpenTrail = (outlines, trail) => {
  for (const outline of outlines || []) {
    for (let index = 0; index < outline.length; index += 1) {
      const start = outline[index];
      const end = outline[(index + 1) % outline.length];
      if (outline.length === 1 || samePoint(start, end)) continue;
      for (let edge = 0; edge < trail.length - 1; edge += 1) {
        if (segmentsIntersect(start, end, trail[edge], trail[edge + 1])) return true;
      }
    }
  }
  return false;
};

export function doesGeometryCrossLasso(geometry, rawPolygon, { fenceOnly = false } = {}) {
  const polygon = fenceOnly ? normalizeLassoTrail(rawPolygon) : normalizeLassoPolygon(rawPolygon);
  if (!geometry || !polygon) return false;
  const lassoBounds = polygonBounds(polygon);
  const bounds = geometry.bounds;
  if (bounds.right < lassoBounds.left || bounds.left > lassoBounds.right
    || bounds.bottom < lassoBounds.top || bounds.top > lassoBounds.bottom) return false;
  if (fenceOnly) return outlinesIntersectOpenTrail(geometry.outlines, polygon);
  if (outlinesIntersectPolygonBoundary(geometry.outlines, polygon)) return true;
  for (const outline of geometry.outlines || []) {
    if (outline.some((point) => isPointInLasso(point, polygon))) return true;
    if (geometry.interiorSelectable && outline.length >= 3
      && polygon.some((point) => isPointInLasso(point, outline))) return true;
  }
  return false;
}

export function resolveLassoHits({
  lassoPolygon,
  mode = 'window',
  annotations,
  callouts,
  pageWidth,
  pageHeight,
  pageNumber,
  selectableAnnotationIndices,
}) {
  const normalizedMode = ['crossing', 'fence'].includes(mode) ? mode : 'window';
  const polygon = normalizedMode === 'fence'
    ? normalizeLassoTrail(lassoPolygon)
    : normalizeLassoPolygon(lassoPolygon);
  if (!polygon) return { annotationIndices: [], calloutIds: [] };
  const selectableSet = selectableAnnotationIndices instanceof Set
    ? selectableAnnotationIndices
    : Array.isArray(selectableAnnotationIndices) ? new Set(selectableAnnotationIndices) : null;
  const geometryHits = (geometry) => normalizedMode === 'window'
    ? isGeometryFullyInsideLasso(geometry, polygon)
    : doesGeometryCrossLasso(geometry, polygon, { fenceOnly: normalizedMode === 'fence' });
  const annotationIndices = [];
  const groupedHits = new Map();
  const groupEntry = (groupId) => {
    if (!groupedHits.has(groupId)) {
      groupedHits.set(groupId, { annotationIndices: [], calloutIds: [], allInside: true, anyHit: false });
    }
    return groupedHits.get(groupId);
  };
  const objects = annotations?.objects || [];
  for (let index = 0; index < objects.length; index += 1) {
    if (selectableSet && !selectableSet.has(index)) continue;
    const object = objects[index];
    const groupId = getAnnotationGroupId(object);
    const geometry = isBlockedFromAreaSelection(object) ? null : annotationToLassoGeometry(object);
    if (groupId) {
      const group = groupEntry(groupId);
      if (!geometry) {
        group.allInside = false;
        continue;
      }
      group.annotationIndices.push(index);
      const hit = geometryHits(geometry);
      if (!hit) group.allInside = false;
      if (hit) group.anyHit = true;
    } else if (geometry && geometryHits(geometry)) {
      annotationIndices.push(index);
    }
  }
  const calloutIds = [];
  for (const callout of Array.isArray(callouts) ? callouts : []) {
    if (!callout?.id) continue;
    if (pageNumber != null && callout.pageNumber != null && Number(callout.pageNumber) !== Number(pageNumber)) continue;
    const geometry = calloutToLassoGeometry(callout, pageWidth, pageHeight);
    const groupId = getCalloutGroupId(callout);
    if (groupId) {
      const group = groupEntry(groupId);
      if (!geometry) {
        group.allInside = false;
        continue;
      }
      group.calloutIds.push(callout.id);
      const hit = geometryHits(geometry);
      if (!hit) group.allInside = false;
      if (hit) group.anyHit = true;
    } else if (geometry && geometryHits(geometry)) {
      calloutIds.push(callout.id);
    }
  }
  for (const group of groupedHits.values()) {
    const includeGroup = normalizedMode === 'window' ? group.allInside : group.anyHit;
    if (!includeGroup || (!group.annotationIndices.length && !group.calloutIds.length)) continue;
    annotationIndices.push(...group.annotationIndices);
    calloutIds.push(...group.calloutIds);
  }
  annotationIndices.sort((a, b) => a - b);
  return { annotationIndices, calloutIds };
}
