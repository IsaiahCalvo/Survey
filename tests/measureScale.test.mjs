import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPageScale,
  buildMeasureLabel,
  layoutMeasureLabel,
  formatMeasureLength,
  pageScaleFromObjects,
  polygonAreaPt,
  scaleFromCalibration,
  scaleFromPreset,
  stampMeasure,
} from '../src/utils/measure/measureScale.js';
import { buildLineCommitJSON, buildPolyShapeCommitJSON } from '../src/utils/annotationCreationCommit.js';

const line = (start, end) => buildLineCommitJSON({ tool: 'line', id: 'l1', start, end, strokeColor: '#000', strokeOpacity: 100, strokeWidth: 2 });

test('preset 1/4" = 1\' is 18 pt per foot', () => {
  assert.deepEqual(scaleFromPreset('1/4'), { ptPerUnit: 18, unit: 'ft', label: '1/4" = 1\'' });
  assert.equal(scaleFromPreset('nope'), null);
});

test('calibration: 100 pt line typed as 10 ft', () => {
  const s = scaleFromCalibration(100, 10, 'ft');
  assert.equal(s.ptPerUnit, 10);
  assert.equal(scaleFromCalibration(100, 0, 'ft'), null);
  assert.equal(scaleFromCalibration(100, 5, 'parsec'), null);
});

test('length label reads feet-inches from a committed line', () => {
  const json = stampMeasure(line({ x: 10, y: 10 }, { x: 10 + 225, y: 10 }), 'length', scaleFromPreset('1/4'));
  const label = buildMeasureLabel(json, scaleFromPreset('1/4'));
  assert.equal(label.text, '12\' 6"');
  assert.equal(label.x, 10 + 225 / 2);
  assert.equal(formatMeasureLength(100, scaleFromCalibration(100, 2.5, 'm')), '2.50 m');
});

test('area label from a committed polygon (world coords)', () => {
  const pts = [{ x: 100, y: 100 }, { x: 136, y: 100 }, { x: 136, y: 136 }, { x: 100, y: 136 }];
  const json = stampMeasure(buildPolyShapeCommitJSON({ tool: 'polygon', id: 'p', points: pts, strokeColor: '#000', strokeOpacity: 100, fillColor: '#000', fillOpacity: 0, strokeWidth: 2 }), 'area', null);
  assert.equal(polygonAreaPt(pts), 1296);
  const label = buildMeasureLabel(json, scaleFromPreset('1/4'));
  assert.equal(label.text, '4.00 sq ft');
  assert.equal(label.x, 118);
  assert.equal(label.y, 118);
});

test('page scale is saved on measurements and re-stamped on change', () => {
  const plain = line({ x: 0, y: 0 }, { x: 50, y: 0 });
  const m = stampMeasure(line({ x: 0, y: 0 }, { x: 90, y: 0 }), 'length', scaleFromPreset('1/8'));
  assert.equal(stampMeasure(plain, 'bogus', null), plain);
  const page = { objects: [plain, m] };
  assert.equal(pageScaleFromObjects(page.objects).ptPerUnit, 9);
  const next = applyPageScale(page, scaleFromPreset('1/4'));
  assert.equal(next.objects[0], plain);
  assert.equal(pageScaleFromObjects(next.objects).ptPerUnit, 18);
  assert.equal(page.objects[1].data.measure.scale.ptPerUnit, 9, 'input not mutated');
  assert.equal(buildMeasureLabel(next.objects[1], pageScaleFromObjects(next.objects)).text, '5\' 0"');
  assert.equal(pageScaleFromObjects([plain]), null);
});

test('length label pill: fixed screen size, above the midpoint, clear of handles', () => {
  const json = stampMeasure(line({ x: 10, y: 100 }, { x: 210, y: 100 }), 'length', scaleFromPreset('1/4'));
  const label = buildMeasureLabel(json, scaleFromPreset('1/4'));
  const at1 = layoutMeasureLabel(label, 1);
  assert.equal(at1.fontSize, 12);
  assert.equal(at1.cx, 110);
  assert.ok(at1.cy + at1.height / 2 <= 100 - 8, 'pill bottom sits >= 8 px above the line');
  // Zoomed out 2x (2 page units per px): same 12 px on screen, so 24 page units.
  const at2 = layoutMeasureLabel(label, 2);
  assert.equal(at2.fontSize, 24);
  assert.ok(Math.abs((100 - at2.cy) - 2 * (100 - at1.cy)) < 1e-9);
});

test('length label on a vertical / diagonal line offsets perpendicular', () => {
  const vert = buildMeasureLabel(stampMeasure(line({ x: 50, y: 0 }, { x: 50, y: 100 }), 'length', null), null);
  const v = layoutMeasureLabel(vert, 1);
  assert.ok(Math.abs(v.cy - 50) < 1e-9 && Math.abs(v.cx - 50) > 8);
  const diag = buildMeasureLabel(stampMeasure(line({ x: 0, y: 100 }, { x: 100, y: 0 }), 'length', null), null);
  const d = layoutMeasureLabel(diag, 1);
  assert.ok(d.cy < 50, 'diagonal label goes screen-up');
  const along = (d.cx - 50) * Math.SQRT1_2 - (d.cy - 50) * Math.SQRT1_2;
  assert.ok(Math.abs(along) < 1e-9, 'offset is purely perpendicular');
});

test('area label pill stays on the centroid', () => {
  const pts = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];
  const json = stampMeasure(buildPolyShapeCommitJSON({ tool: 'polygon', id: 'p', points: pts, strokeColor: '#000', strokeOpacity: 100, fillColor: '#000', fillOpacity: 0, strokeWidth: 2 }), 'area', null);
  const box = layoutMeasureLabel(buildMeasureLabel(json, null), 1);
  assert.equal(box.cx, 20);
  assert.equal(box.cy, 20);
});
