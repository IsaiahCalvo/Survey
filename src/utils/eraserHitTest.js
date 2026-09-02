/**
 * eraserHitTest.js — determines which annotations an eraser stroke touches.
 *
 * Exports getEraserStrokeBounds, sampleEraserStroke (densifies the stroke path),
 * eraserStrokeTouchesObject (samples the stroke and hit-tests each point via
 * geometryHitTest's isPointOnObject), getEraserCandidateId, and
 * getEraserDeleteDiagnostics. Used by the eraser tool to find delete candidates.
 */
import { isPointOnObject } from './geometryHitTest.js';
import { getAnnotationHistoryId } from './annotationLocalHistory.js';

const MIN_SAMPLE_STEP = 2;
const MAX_SAMPLE_STEP = 8;

export function getEraserStrokeBounds(points = [], radius = 0) {
  const finite = points.filter((point) => (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ));
  if (finite.length === 0) {
    return null;
  }

  let minX = finite[0].x;
  let minY = finite[0].y;
  let maxX = finite[0].x;
  let maxY = finite[0].y;
  finite.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    left: minX - radius,
    top: minY - radius,
    right: maxX + radius,
    bottom: maxY + radius,
    width: (maxX - minX) + radius * 2,
    height: (maxY - minY) + radius * 2,
  };
}

export function getEraserCandidateId(obj, fallbackIndex = null) {
  return getAnnotationHistoryId(obj)
    || obj?.callout?.id
    || (obj?.type === 'callout' ? obj.id : null)
    || `index:${fallbackIndex}`;
}

function sampleSegment(start, end, step) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  const count = Math.max(1, Math.ceil(distance / Math.max(1, step)));
  const samples = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    samples.push({
      x: start.x + dx * t,
      y: start.y + dy * t,
    });
  }
  return samples;
}

export function sampleEraserStroke(points = [], radius = 0) {
  const finite = points.filter((point) => (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ));
  if (finite.length <= 1) {
    return finite;
  }

  const step = Math.max(MIN_SAMPLE_STEP, Math.min(Math.max(radius / 2, MIN_SAMPLE_STEP), MAX_SAMPLE_STEP));
  const samples = [finite[0]];
  for (let i = 1; i < finite.length; i += 1) {
    const segmentSamples = sampleSegment(finite[i - 1], finite[i], step);
    samples.push(...segmentSamples.slice(1));
  }
  return samples;
}

export function eraserStrokeTouchesObject({ eraserPoints, eraserRadius, object }) {
  if (!object || !Array.isArray(eraserPoints) || eraserPoints.length === 0) {
    return false;
  }

  const samples = sampleEraserStroke(eraserPoints, eraserRadius);
  return samples.some((point) => isPointOnObject(point, object, eraserRadius));
}

export function getEraserDeleteDiagnostics({ beforeObjects = [], afterObjects = [] } = {}) {
  const beforeIds = beforeObjects.map((obj, index) => getEraserCandidateId(obj, index));
  const afterIds = new Set(afterObjects.map((obj, index) => getEraserCandidateId(obj, index)));
  const finalDeletedAnnotationIds = beforeIds.filter((id) => id && !afterIds.has(id));
  let changedObjectsCount = 0;
  const max = Math.max(beforeObjects.length, afterObjects.length);

  for (let index = 0; index < max; index += 1) {
    const before = beforeObjects[index] ?? null;
    const after = afterObjects[index] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changedObjectsCount += 1;
    }
  }

  return {
    finalDeletedAnnotationIds,
    objectDelta: afterObjects.length - beforeObjects.length,
    changedObjectsCount,
  };
}
