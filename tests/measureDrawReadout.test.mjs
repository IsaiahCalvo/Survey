// Nightly 'measure-draw-readout': while a Length is drawn, a pill beside the
// pointer reads its length and angle (Drawboard's "4in · 0°").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawAngleDegrees, drawReadout } from '../src/utils/measure/drawReadout.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('angle: 0 right, 90 up, 180 left, 270 down, whole degrees', () => {
  const o = { x: 100, y: 100 };
  assert.equal(drawAngleDegrees(o, { x: 200, y: 100 }), 0);
  assert.equal(drawAngleDegrees(o, { x: 100, y: 0 }), 90);
  assert.equal(drawAngleDegrees(o, { x: 0, y: 100 }), 180);
  assert.equal(drawAngleDegrees(o, { x: 100, y: 200 }), 270);
  assert.equal(drawAngleDegrees(o, { x: 200, y: 0 }), 45);
  assert.equal(drawAngleDegrees(o, o), 0);
});

test('readout: length in the page scale and the angle, beside the pointer, kept on the page', () => {
  const r = drawReadout({ x: 0, y: 100 }, { x: 288, y: 100 }, null, 1, { width: 612, height: 792 });
  assert.equal(r.text, '4 in · 0°');
  assert.ok(r.x > 288 && r.y > 100);
  const scaled = drawReadout({ x: 0, y: 0 }, { x: 72, y: 0 }, { ptPerUnit: 6, unit: 'ft' }, 1);
  assert.match(scaled.text, / · 0°$/);
  assert.doesNotMatch(scaled.text, /no scale/);
  const edge = drawReadout({ x: 500, y: 780 }, { x: 600, y: 780 }, null, 1, { width: 612, height: 792 });
  assert.ok(edge.x < 600, 'flips left at the right edge');
  assert.ok(edge.y < 780, 'flips up at the bottom edge');
  assert.equal(drawReadout({ x: 1, y: 1 }, { x: 1, y: 1 }, null), null);
});

test('wiring: Nightly flag, drawn in the page layer for a Length only', () => {
  assert.equal(FEATURE_FLAGS['measure-draw-readout']?.stage, 'beta');
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /measureDrawReadoutOn && measureMode === 'length' && shapeCreation && shapeCreation\.tool === 'line'/);
  assert.match(layer, /data-measure-draw-readout/);
  const migration = readFileSync(new URL('../supabase/migrations/20261117160000_measure_draw_readout_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'measure-draw-readout', 'off'/);
});
