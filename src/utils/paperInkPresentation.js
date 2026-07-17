import {
  commandsToPolygonSet,
  polygonSetToCommands,
  shouldUsePaperInkOutline,
} from './paperAnnotationGeometry.js';
import { isPartialEraseEligible } from './eraserPolicy.js';

const projectionCache = new WeakMap();

const visiblePaint = (value) => {
  const paint = String(value ?? '').trim().toLowerCase();
  return paint !== ''
    && paint !== 'none'
    && paint !== 'transparent'
    && paint !== 'rgba(0,0,0,0)'
    && paint !== 'rgba(0, 0, 0, 0)';
};

/**
 * Paint freehand ink as its paper outline before the first erase.
 * Persisted centerlines stay compact; the visual model matches the geometry
 * that partial erase will commit, so pointer-up cannot reshape untouched ink.
 *
 * UX 2026-07-17 (import-normalization item 5c): the imported-ink skip that
 * used to live here is retired.
 * - Imported FILLED/pressure ink converges to the native polygon
 *   representation at import (item 4) and carries a visible fill, so the
 *   `visiblePaint(object.fill)` guard below already returns it unchanged —
 *   the provenance check was redundant for it.
 * - Imported OPEN ink was skipped because its STORED width (often 0.82pt)
 *   differed from its RENDERED width (renderer clamped to 2.5): projecting
 *   from the stored width would have visibly thinned the stroke when the
 *   eraser armed. Item 5a moved that clamp into the stored value, so stored
 *   == rendered and wide imported strokes now project exactly like native
 *   ink — the eraser-mode presentation matches the geometry partial erase
 *   (pageSpaceEraser forcePolygon) will actually commit.
 */
export function projectPaperInkForPresentation(object) {
  if (
    !object
    || object.paperEraserGeometry
    || object.paperPresentationGeometry
    || visiblePaint(object.fill)
    || !visiblePaint(object.stroke)
  ) return object;

  const strokeWidth = Number(object.strokeWidth);
  if (!Number.isFinite(strokeWidth) || strokeWidth <= 0) return object;
  const scaleX = Math.abs(Number(object.scaleX) || 1);
  const scaleY = Math.abs(Number(object.scaleY) || 1);
  const effectiveWidth = strokeWidth * Math.sqrt(scaleX * scaleY);
  const nonUniformTransform = Math.abs(scaleX - scaleY) > 1e-7;
  if (!nonUniformTransform && !shouldUsePaperInkOutline(effectiveWidth)) return object;
  if (!isPartialEraseEligible(object)) return object;

  const cached = projectionCache.get(object);
  if (
    cached
    && cached.path === object.path
    && cached.stroke === object.stroke
    && cached.strokeWidth === strokeWidth
    && cached.scaleX === scaleX
    && cached.scaleY === scaleY
  ) return cached.projected;

  const polygons = commandsToPolygonSet(object.path, {
    fill: false,
    strokeWidth,
    simplifyTolerance: Math.max(0.1, strokeWidth * 0.25),
  });
  if (!polygons.length) return object;

  const projected = {
    ...object,
    path: polygonSetToCommands(polygons),
    polygons,
    fill: object.stroke,
    stroke: 'transparent',
    strokeWidth: 0,
    fillRule: 'evenodd',
    paperPresentationGeometry: 'v1',
  };
  projectionCache.set(object, {
    path: object.path,
    stroke: object.stroke,
    strokeWidth,
    scaleX,
    scaleY,
    projected,
  });
  return projected;
}
