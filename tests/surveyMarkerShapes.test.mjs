// Owner 2026-10-13: Survey Marker draw modes — Rectangle / Freehand / Smart
// fill. The outline rides inside `bounds` (bounds.shape) next to the box every
// existing reader keeps using. See src/survey/markerShapes.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER_STROKE_DEFAULT_WIDTH,
  buildPolygonMarkerBounds,
  buildStrokeMarkerBounds,
  carryMarkerShape,
  getMarkerDrawKind,
  getMarkerShape,
  markerShapeHitTest,
  markerShapePathData,
  normalizeMarkerPolygons,
  projectMarkerShape,
  simplifyPolyline,
} from '../src/survey/markerShapes.js';
import { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { isPlacedSurveyMarker } from '../src/services/surveyMarkerSyncDiff.js';
import {
  buildPastedSurveyMarker,
  patchSurveyMarkerRenderPages,
  placeSurveyMarkerRecord,
  surveyMarkerClipboardEntry,
  surveyMarkerRenderEntry,
  translateSurveyMarkerRecord,
  unplaceSurveyMarkerRecord,
} from '../src/utils/surveyMarkerFamily.js';
import { surveyMarkerToEraserObject } from '../src/utils/surveyMarkerEraser.js';
import { fakeSmartFillPolygon } from '../src/survey/devFakeSmartFillProvider.js';

const diagonal = Array.from({ length: 41 }, (_, i) => ({ x: 100 + i * 2, y: 200 + i }));

test('a freehand stroke becomes a box padded by half the width, with its centreline', () => {
  const bounds = buildStrokeMarkerBounds(diagonal);
  const half = MARKER_STROKE_DEFAULT_WIDTH / 2;
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [100 - half, 200 - half, 80 + 2 * half, 40 + 2 * half]);
  assert.equal(bounds.shape.type, 'stroke');
  assert.equal(bounds.shape.v, 1);
  assert.equal(bounds.shape.width, MARKER_STROKE_DEFAULT_WIDTH);
  assert.deepEqual(bounds.shape.frame, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  // A straight line simplifies to its two ends.
  assert.deepEqual(bounds.shape.points, [[100, 200], [180, 240]]);
  // It is plain JSON (it is stored in the bounds JSONB column).
  assert.deepEqual(JSON.parse(JSON.stringify(bounds)), bounds);
});

test('a press that never moved draws no freehand marker', () => {
  assert.equal(buildStrokeMarkerBounds([{ x: 5, y: 5 }]), null);
  assert.equal(buildStrokeMarkerBounds([{ x: 5, y: 5 }, { x: 6, y: 5 }]), null);
  assert.equal(buildStrokeMarkerBounds([]), null);
  assert.equal(buildStrokeMarkerBounds(null), null);
});

test('a long wiggly stroke is thinned to the storage cap', () => {
  const wiggle = Array.from({ length: 5000 }, (_, i) => ({ x: i * 0.5, y: 50 + 20 * Math.sin(i / 3) }));
  const bounds = buildStrokeMarkerBounds(wiggle);
  assert.ok(bounds.shape.points.length <= 600, `kept ${bounds.shape.points.length}`);
  assert.ok(bounds.shape.points.length > 20);
});

test('simplifyPolyline keeps the corners of an L', () => {
  const pts = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
  assert.deepEqual(simplifyPolyline(pts, 0.5), [[0, 0], [10, 0], [10, 10]]);
});

test('smart-fill polygons: GeoJSON Polygon with closed rings and a hole', () => {
  const geo = fakeSmartFillPolygon({ x: 300, y: 400 });
  const polygons = normalizeMarkerPolygons({ polygons: geo });
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].length, 2, 'outer ring + hole');
  assert.equal(polygons[0][0].length, 4, 'closing point dropped');
  const bounds = buildPolygonMarkerBounds({ polygons: geo });
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [240, 360, 120, 80]);
  assert.equal(bounds.shape.type, 'polygon');
  assert.equal(getMarkerDrawKind({ bounds }), 'smartFill');
});

test('smart-fill polygons: every accepted input form', () => {
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const ringObj = ring.map(([x, y]) => ({ x, y }));
  const expectOne = (input) => {
    const out = normalizeMarkerPolygons(input);
    assert.ok(out, JSON.stringify(input).slice(0, 80));
    assert.deepEqual(out[0][0], ring);
  };
  expectOne(ring); // bare ring
  expectOne([ring]); // Polygon coordinates
  expectOne([[ring]]); // MultiPolygon coordinates
  expectOne(ringObj); // {x, y} points
  expectOne({ type: 'Polygon', coordinates: [ring] });
  expectOne({ type: 'MultiPolygon', coordinates: [[ring], [[[20, 20], [30, 20], [30, 30]]]] });
  expectOne({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } });
  expectOne({ polygons: { type: 'Polygon', coordinates: [ring] } });
  assert.equal(normalizeMarkerPolygons({ type: 'MultiPolygon', coordinates: [[ring], [[[20, 20], [30, 20], [30, 30]]]] }).length, 2);
});

test('smart-fill polygons: junk is refused, never thrown', () => {
  for (const junk of [null, undefined, 42, 'x', {}, [], [[1, 2]], [[NaN, 1], [2, 2], [3, 3]], { polygons: null }]) {
    assert.equal(normalizeMarkerPolygons(junk), null);
    assert.equal(buildPolygonMarkerBounds(junk), null);
  }
});

test('smart-fill polygons: a huge outline is thinned to the storage cap', () => {
  const ring = Array.from({ length: 20000 }, (_, i) => {
    const a = (i / 20000) * Math.PI * 2;
    return [500 + 200 * Math.cos(a), 500 + 200 * Math.sin(a)];
  });
  const out = normalizeMarkerPolygons([ring]);
  const count = out[0][0].length;
  assert.ok(count <= 6000 && count >= 16, `kept ${count}`);
});

// Bugbot on #817: thinning a dense outline must drop a hole (or a whole
// polygon) that collapses below three points, not keep it as null and throw.
test('smart-fill polygons: thinning drops a hole or an island that collapses', () => {
  const circle = (cx, cy, r, n) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  const outer = circle(500, 500, 200, 20000);
  const tinyHole = circle(500, 500, 0.1, 40);
  const bigHole = circle(500, 500, 50, 400);
  const tinyIsland = circle(900, 900, 0.1, 40);
  const out = normalizeMarkerPolygons({ type: 'MultiPolygon', coordinates: [[outer, tinyHole, bigHole], [tinyIsland]] });
  assert.equal(out.length, 1, 'the island that collapsed is gone');
  assert.equal(out[0].length, 2, 'outer ring + the hole that survived');
  for (const ring of out[0]) {
    assert.ok(Array.isArray(ring) && ring.length >= 3);
  }
  const bounds = buildPolygonMarkerBounds({ polygons: [[outer, tinyHole]] });
  assert.ok(bounds, 'the marker is still made');
  assert.equal(bounds.shape.polygons[0].length, 1, 'only the outline is left');
});

test('getMarkerShape: plain boxes, malformed or newer outlines read as "no outline"', () => {
  assert.equal(getMarkerShape({ bounds: { x: 1, y: 1, width: 5, height: 5 } }), null);
  const bounds = buildStrokeMarkerBounds(diagonal);
  assert.equal(getMarkerShape({ bounds }), bounds.shape);
  assert.equal(getMarkerShape(bounds), bounds.shape, 'a canvas entry has bounds spread at the top');
  assert.equal(getMarkerShape({ shape: { ...bounds.shape, v: 2 } }), null);
  assert.equal(getMarkerShape({ shape: { ...bounds.shape, frame: { x: 0, y: 0, width: 0, height: 1 } } }), null);
  assert.equal(getMarkerShape({ shape: { ...bounds.shape, type: 'spline' } }), null);
  assert.equal(getMarkerDrawKind({ bounds: { x: 0, y: 0, width: 1, height: 1 } }), 'rectangle');
  assert.equal(getMarkerDrawKind({ bounds }), 'freehand');
});

test('the outline follows the box when it is moved or resized', () => {
  const bounds = buildStrokeMarkerBounds(diagonal);
  const same = projectMarkerShape(bounds.shape, bounds);
  assert.deepEqual(same.points, [[100, 200], [180, 240]]);
  assert.equal(same.width, MARKER_STROKE_DEFAULT_WIDTH);
  const moved = projectMarkerShape(bounds.shape, { ...bounds, x: bounds.x + 50, y: bounds.y - 20 });
  assert.deepEqual(moved.points, [[150, 180], [230, 220]]);
  const doubled = projectMarkerShape(bounds.shape, { ...bounds, width: bounds.width * 2, height: bounds.height * 2 });
  assert.equal(doubled.width, MARKER_STROKE_DEFAULT_WIDTH * 2);
  assert.deepEqual(doubled.points[0], [100 + 6, 200 + 6]);
  assert.equal(projectMarkerShape(bounds.shape, { x: 0, y: 0, width: 0, height: 5 }), null);
});

test('hit testing: on the stroke, not in the empty part of its box; polygon holes stay clear', () => {
  const bounds = buildStrokeMarkerBounds(diagonal);
  const stroke = projectMarkerShape(bounds.shape, bounds);
  assert.equal(markerShapeHitTest(stroke, { x: 140, y: 220 }), true);
  assert.equal(markerShapeHitTest(stroke, { x: 140, y: 225 }), true, 'within half the width');
  assert.equal(markerShapeHitTest(stroke, { x: 100, y: 240 }), false, 'empty corner of the box');
  const poly = projectMarkerShape(buildPolygonMarkerBounds(fakeSmartFillPolygon({ x: 300, y: 400 })).shape,
    buildPolygonMarkerBounds(fakeSmartFillPolygon({ x: 300, y: 400 })));
  assert.equal(markerShapeHitTest(poly, { x: 250, y: 370 }), true, 'in the fill');
  assert.equal(markerShapeHitTest(poly, { x: 300, y: 400 }), false, 'in the hole');
  assert.equal(markerShapeHitTest(poly, { x: 300, y: 400 }, 25), true, 'near the hole edge with tolerance');
  assert.equal(markerShapeHitTest(poly, { x: 100, y: 100 }), false);
});

test('svg path data: open stroke, closed rings', () => {
  const bounds = buildStrokeMarkerBounds(diagonal);
  assert.equal(markerShapePathData(projectMarkerShape(bounds.shape, bounds)), 'M100 200 L180 240');
  const pb = buildPolygonMarkerBounds([[[0, 0], [10, 0], [10, 10]]]);
  assert.equal(markerShapePathData(projectMarkerShape(pb.shape, pb)), 'M0 0 L10 0 L10 10 Z');
});

test('carryMarkerShape keeps the outline when a handler rebuilds the box', () => {
  const bounds = buildStrokeMarkerBounds(diagonal);
  const next = carryMarkerShape({ x: 1, y: 2, width: 3, height: 4, angle: 0 }, bounds);
  assert.equal(next.shape, bounds.shape);
  assert.deepEqual(carryMarkerShape({ x: 1, y: 2, width: 3, height: 4 }, { x: 0, y: 0, width: 1, height: 1 }), { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(carryMarkerShape(null, bounds), null);
});

const freehandMarker = () => ({
  id: 'sm-free',
  annotationId: 'sm-free',
  pageNumber: 2,
  bounds: buildStrokeMarkerBounds(diagonal),
  categoryId: 'c1',
  moduleId: 'm1',
  regionId: null,
  name: 'Cameras 1',
  entityId: 'e1',
  entityColor: 'rgba(84,140,113,0.4)',
  checklistResponses: {},
});

test('sync round trip: the outline survives the Supabase row and back (no schema change)', () => {
  const marker = freehandMarker();
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: marker.id, annotation: marker });
  assert.deepEqual(row.bounds, marker.bounds, 'stored in the existing bounds JSONB column');
  const rowColumns = Object.keys(row).sort();
  assert.ok(!rowColumns.includes('shape'), 'no new column');
  const back = mapSurveyMarkerRowToLocalAnnotation({ ...JSON.parse(JSON.stringify(row)), id: 9, updated_at: 'now' });
  assert.deepEqual(back.bounds, marker.bounds);
  assert.equal(getMarkerDrawKind(back), 'freehand');
  assert.equal(isPlacedSurveyMarker(back), true);
});

test('an older reader (box only) still gets the box', () => {
  const marker = freehandMarker();
  const entry = surveyMarkerRenderEntry(marker.id, marker);
  // What every box consumer reads: x / y / width / height.
  assert.deepEqual([entry.x, entry.y, entry.width, entry.height], [marker.bounds.x, marker.bounds.y, marker.bounds.width, marker.bounds.height]);
  const eraserBox = surveyMarkerToEraserObject(entry);
  assert.equal(eraserBox.type, 'rect');
  assert.equal(eraserBox.width, marker.bounds.width);
  // And the new renderer gets the outline.
  assert.equal(entry.shape, marker.bounds.shape);
});

test('a plain rectangle marker is unchanged everywhere', () => {
  const rect = { pageNumber: 1, bounds: { x: 10, y: 20, width: 30, height: 40 }, moduleId: 'm1', entityColor: '#f00' };
  const entry = surveyMarkerRenderEntry('r1', rect);
  assert.equal('shape' in entry, false);
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'r1', annotation: rect });
  assert.deepEqual(row.bounds, { x: 10, y: 20, width: 30, height: 40 });
});

test('move, copy / paste, cut / place keep the outline in step with the box', () => {
  const marker = freehandMarker();
  const moved = translateSurveyMarkerRecord(marker, 30, 10);
  const projected = projectMarkerShape(moved.bounds.shape, moved.bounds);
  assert.deepEqual(projected.points, [[130, 210], [210, 250]]);
  const entry = surveyMarkerClipboardEntry(marker);
  const pasted = buildPastedSurveyMarker(entry, { id: 'copy', pageNumber: 3, dx: 15, dy: 15 });
  assert.deepEqual(projectMarkerShape(pasted.bounds.shape, pasted.bounds).points, [[115, 215], [195, 255]]);
  const cut = unplaceSurveyMarkerRecord(marker);
  assert.equal(cut.bounds, null);
  const placed = placeSurveyMarkerRecord(cut, { pageNumber: 4, bounds: entry.bounds });
  assert.equal(getMarkerDrawKind(placed), 'freehand');
});

test('the canvas render lists carry the outline after a patch (undo / redo / move)', () => {
  const marker = freehandMarker();
  const next = patchSurveyMarkerRenderPages({}, { [marker.id]: marker }, [marker.id], { selectedModuleId: 'm1' });
  assert.equal(next[2][0].shape, marker.bounds.shape);
});

test('the eraser takes a freehand marker only where its stroke is (also when rotated)', async () => {
  const { getSurveyMarkerEraserHitIds } = await import('../src/utils/surveyMarkerEraser.js');
  const marker = freehandMarker();
  const entry = surveyMarkerRenderEntry(marker.id, marker); // stroke (100,200)->(180,240)
  const hit = (points, e = entry) => getSurveyMarkerEraserHitIds({
    surveyMarkers: [e], visibleIds: new Set([marker.id]), eraserPoints: points, eraserRadius: 3, canErase: () => true,
  });
  assert.deepEqual(hit([{ x: 140, y: 220 }]), [marker.id], 'on the stroke');
  assert.deepEqual(hit([{ x: 100, y: 240 }]), [], 'empty corner of its box');
  // Rotated 180 degrees about the box centre: the stroke now runs the other
  // diagonal's mirror, so the old empty corner (100,240) lies... still empty,
  // and the point-mirror of (110,205) is on the stroke.
  const rotated = { ...entry, angle: 180 };
  const cx = entry.x + entry.width / 2;
  const cy = entry.y + entry.height / 2;
  assert.deepEqual(hit([{ x: 2 * cx - 110, y: 2 * cy - 205 }], rotated), [marker.id]);
  assert.deepEqual(hit([{ x: 110, y: 205 }], { ...entry, angle: 90 }).length, 0);
  // A plain box marker keeps the old whole-box rule.
  const box = { annotationId: 'b', x: 0, y: 0, width: 50, height: 50 };
  assert.deepEqual(getSurveyMarkerEraserHitIds({
    surveyMarkers: [box], visibleIds: new Set(['b']), eraserPoints: [{ x: 2, y: 48 }], eraserRadius: 1, canErase: () => true,
  }), ['b']);
});

test('the canvas painter (eraser preview) draws the outline, not the box', async () => {
  const { drawAnnotationObject } = await import('../src/utils/annotationCanvasPainter.js');
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : (...args) => { calls.push([key, ...args]); }),
    set: (target, key, value) => { target[key] = value; calls.push([`set:${String(key)}`, value]); return true; },
  });
  const bounds = buildStrokeMarkerBounds(diagonal);
  drawAnnotationObject(ctx, {
    type: 'rect', left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height,
    fill: 'rgba(84,140,113,0.4)', globalCompositeOperation: 'multiply', opacity: 1, angle: 0,
    surveyMarkerShape: projectMarkerShape(bounds.shape, bounds),
  });
  assert.ok(calls.some(([k, x, y]) => k === 'moveTo' && x === 100 && y === 200));
  assert.ok(calls.some(([k, x, y]) => k === 'lineTo' && x === 180 && y === 240));
  assert.ok(calls.some(([k]) => k === 'stroke'));
  assert.ok(!calls.some(([k]) => k === 'rect' || k === 'fillRect'), 'no box');
  calls.length = 0;
  const pb = buildPolygonMarkerBounds(fakeSmartFillPolygon({ x: 300, y: 400 }));
  drawAnnotationObject(ctx, {
    type: 'rect', left: pb.x, top: pb.y, width: pb.width, height: pb.height,
    fill: 'rgba(84,140,113,0.4)', globalCompositeOperation: 'multiply', opacity: 1,
    surveyMarkerShape: projectMarkerShape(pb.shape, pb),
  });
  assert.ok(calls.some(([k, rule]) => k === 'fill' && rule === 'evenodd'), 'holes stay clear');
  assert.equal(calls.filter(([k]) => k === 'closePath').length, 2);
});
