import { eraserStrokeTouchesObject } from './eraserHitTest.js';
import { getEraserOperation } from './eraserPolicy.js';

const normalizeAngle = (value) => {
  const angle = Number(value);
  return Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0;
};

// Keep this projection identical to the survey-marker rect rendered by
// SVGAnnotationLayer and LightweightAnnotationOverlay. The eraser can then use
// the same geometry hit tester as every other annotation without moving marker
// ownership into annotations.objects.
export function surveyMarkerToEraserObject(marker) {
  if (!marker?.annotationId) return null;
  return {
    type: 'rect',
    annotationId: marker.annotationId,
    moduleId: marker.moduleId ?? null,
    regionId: marker.regionId ?? null,
    layer: marker.layer || null,
    left: Number(marker.x) || 0,
    top: Number(marker.y) || 0,
    width: Number(marker.width) || 0,
    height: Number(marker.height) || 0,
    fill: marker.needsEntity ? 'transparent' : (marker.color || 'rgba(255,235,59,0.25)'),
    stroke: marker.needsEntity ? '#4A90E2' : 'transparent',
    strokeWidth: marker.needsEntity ? 2 : 0,
    strokeDashArray: marker.needsEntity ? [5, 5] : null,
    globalCompositeOperation: 'multiply',
    opacity: 1,
    scaleX: 1,
    scaleY: 1,
    angle: normalizeAngle(marker.angle),
  };
}

/**
 * Whole-delete survey-marker hits for one eraser segment/gesture.
 *
 * `visibleIds` comes from the live SVG DOM captured at pointer-down. It is an
 * authority list, not just a speed hint: a filtered/hidden marker must never be
 * erased merely because its source geometry still exists.
 */
export function getSurveyMarkerEraserHitIds({
  surveyMarkers = [],
  visibleIds,
  excludeIds,
  eraserPoints,
  eraserRadius,
  canErase,
  boundsAllow,
  mode = 'entire',
} = {}) {
  if (!(visibleIds instanceof Set) || visibleIds.size === 0) return [];
  if (!Array.isArray(surveyMarkers) || !Array.isArray(eraserPoints) || eraserPoints.length === 0) {
    return [];
  }
  // Partial/pixel eraser is ink-only. Markers project to rects, so
  // getEraserOperation(..., 'partial') is 'skip'. Default mode stays
  // 'entire' so callers that omit it keep current entire-mode hits until
  // the preview lane passes the live gesture mode (KB-1 Part 2).

  const hits = [];
  const seen = new Set();
  for (const marker of surveyMarkers) {
    const id = marker?.annotationId == null ? '' : String(marker.annotationId);
    if (!id || seen.has(id) || !visibleIds.has(id) || excludeIds?.has(id)) continue;
    seen.add(id);
    if (typeof canErase !== 'function' || canErase(id, marker) !== true) continue;
    if (typeof boundsAllow === 'function' && !boundsAllow(id)) continue;
    const object = surveyMarkerToEraserObject(marker);
    if (!object || getEraserOperation(object, mode) === 'skip') continue;
    if (!eraserStrokeTouchesObject({ eraserPoints, eraserRadius, object })) continue;
    hits.push(id);
  }
  return hits;
}
