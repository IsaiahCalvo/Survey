import { eraserStrokeTouchesObject, sampleEraserStroke } from './eraserHitTest.js';
import { getMarkerShape, markerShapeHitTest, projectMarkerShape } from '../survey/markerShapes.js';

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
} = {}) {
  if (!(visibleIds instanceof Set) || visibleIds.size === 0) return [];
  if (!Array.isArray(surveyMarkers) || !Array.isArray(eraserPoints) || eraserPoints.length === 0) {
    return [];
  }

  const hits = [];
  const seen = new Set();
  for (const marker of surveyMarkers) {
    const id = marker?.annotationId == null ? '' : String(marker.annotationId);
    if (!id || seen.has(id) || !visibleIds.has(id) || excludeIds?.has(id)) continue;
    seen.add(id);
    if (typeof canErase !== 'function' || canErase(id, marker) !== true) continue;
    if (typeof boundsAllow === 'function' && !boundsAllow(id)) continue;
    const object = surveyMarkerToEraserObject(marker);
    if (!object || !eraserStrokeTouchesObject({ eraserPoints, eraserRadius, object })) continue;
    if (!eraserTouchesMarkerOutline(marker, eraserPoints, eraserRadius)) continue;
    hits.push(id);
  }
  return hits;
}

// Owner 2026-10-13: a freehand / smart-fill marker (src/survey/markerShapes.js)
// is only erased where its outline is — a pass through the empty part of its
// box leaves it alone. A plain box marker always passes (the box IS its ink).
function eraserTouchesMarkerOutline(marker, eraserPoints, eraserRadius) {
  const shape = getMarkerShape(marker);
  if (!shape) return true;
  const box = {
    x: Number(marker.x) || 0,
    y: Number(marker.y) || 0,
    width: Number(marker.width) || 0,
    height: Number(marker.height) || 0,
  };
  const projected = projectMarkerShape(shape, box);
  if (!projected) return true;
  const angle = normalizeAngle(marker.angle);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const rad = (-angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const toBoxFrame = (pt) => {
    if (!angle) return pt;
    const dx = Number(pt.x) - cx;
    const dy = Number(pt.y) - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  return sampleEraserStroke(eraserPoints, eraserRadius)
    .some((pt) => markerShapeHitTest(projected, toBoxFrame(pt), Math.max(0, Number(eraserRadius) || 0)));
}
