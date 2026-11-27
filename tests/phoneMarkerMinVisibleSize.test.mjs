import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildDotMarkerBounds,
  buildStrokeMarkerBounds,
  effectiveMarkerBoxRect,
  effectiveMarkerStrokeWidth,
  isDotProjectedShape,
  MIN_MARKER_VISIBLE_DESKTOP_PX,
  MIN_MARKER_VISIBLE_PHONE_PX,
  MIN_STROKE_VISIBLE_PHONE_PX,
  projectMarkerShape,
} from '../src/survey/markerShapes.js';

test('#1815: existing 12 pt dot markers keep a 14 px visible floor at phone ~24% default zoom', () => {
  const bounds = buildDotMarkerBounds([500, 400], { width: 12 });
  const projected = projectMarkerShape(bounds.shape, bounds);
  assert.equal(isDotProjectedShape(projected), true);

  const zoom = 0.24;
  const inverseScale = 1 / zoom;
  const visiblePageUnits = effectiveMarkerStrokeWidth(projected, { inverseScale, compact: true });
  const screenPx = visiblePageUnits * zoom;
  assert.ok(Math.abs(screenPx - MIN_MARKER_VISIBLE_PHONE_PX) < 1e-6, `expected ${MIN_MARKER_VISIBLE_PHONE_PX}px, got ${screenPx}px`);
  // Stored geometry is never mutated.
  assert.equal(bounds.shape.width, 12);
});

test('#1815: zooming in past the floor restores natural viewBox scaling', () => {
  const bounds = buildDotMarkerBounds([500, 400], { width: 12 });
  const projected = projectMarkerShape(bounds.shape, bounds);

  // At 200% zoom, 12 pt = 24 px (> 14 px), so no floor is applied.
  assert.equal(effectiveMarkerStrokeWidth(projected, { inverseScale: 0.5, compact: true }), 12);
  // On desktop at 100% zoom, 12 pt = 12 px (> 10 px), so no floor is applied.
  assert.equal(effectiveMarkerStrokeWidth(projected, { inverseScale: 1, compact: false }), 12);
  // On desktop at 24% zoom, 12 pt would be 2.9 px, floored to 10 px.
  const desktopFitUnits = effectiveMarkerStrokeWidth(projected, { inverseScale: 1 / 0.24, compact: false });
  assert.ok(Math.abs(desktopFitUnits * 0.24 - MIN_MARKER_VISIBLE_DESKTOP_PX) < 1e-6);
});

test('#1815: long freehand strokes keep a gentler stroke floor and are not treated as dots', () => {
  const bounds = buildStrokeMarkerBounds([[100, 100], [300, 100]], { width: 12 });
  const projected = projectMarkerShape(bounds.shape, bounds);
  assert.equal(isDotProjectedShape(projected), false);

  const zoom = 0.24;
  const units = effectiveMarkerStrokeWidth(projected, { inverseScale: 1 / zoom, compact: true });
  assert.ok(Math.abs(units * zoom - MIN_STROKE_VISIBLE_PHONE_PX) < 1e-6);
});

test('#1815: tiny plain box markers expand symmetrically around their center while room boxes stay unchanged', () => {
  const zoom = 0.24;
  const inverseScale = 1 / zoom;
  const tiny = { left: 100, top: 200, width: 12, height: 12 };
  const expanded = effectiveMarkerBoxRect(tiny, { inverseScale, compact: true });
  assert.ok(Math.abs(expanded.width * zoom - MIN_MARKER_VISIBLE_PHONE_PX) < 1e-6);
  assert.ok(Math.abs(expanded.height * zoom - MIN_MARKER_VISIBLE_PHONE_PX) < 1e-6);
  assert.ok(Math.abs((expanded.left + expanded.width / 2) - (tiny.left + tiny.width / 2)) < 1e-6);
  assert.ok(Math.abs((expanded.top + expanded.height / 2) - (tiny.top + tiny.height / 2)) < 1e-6);

  const room = { left: 100, top: 200, width: 220, height: 160 };
  assert.equal(effectiveMarkerBoxRect(room, { inverseScale, compact: true }), room);
});

test('#1815: SVGAnnotationLayer wires the non-destructive marker visibility floor into renderSurveyMarkerEntry', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/SVGAnnotationLayer.jsx'), 'utf8');
  assert.match(src, /effectiveMarkerStrokeWidth\(projectedShape,\s*\{\s*inverseScale,\s*compact:\s*compactMarkerViewport\s*\}\)/);
  assert.match(src, /effectiveMarkerBoxRect\(bbox,\s*\{\s*inverseScale,\s*compact:\s*compactMarkerViewport\s*\}\)/);
});
