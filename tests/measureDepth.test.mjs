// Polylength, Wall area and Volume (Nightly flag 'measure-depth', Drawboard
// Projects trial audit 2026-11-09): Drawboard's area measure carries a depth,
// giving wall area (outline x depth) and volume (area x depth), and its
// Polylength reads an open run of segments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEPTH_MEASURE_KINDS,
  MEASURE_DEPTH_STORAGE_KEY,
  buildMeasureLabel,
  formatMeasureVolume,
  formatMeasureWallArea,
  isPolyMeasureFor,
  loadMeasureDepth,
  measureBaseTool,
  normalizeMeasureDepth,
  polylineLengthPt,
  polylineMidpoint,
  rememberMeasureDepth,
  scaleFromPreset,
  stampMeasure,
} from '../src/utils/measure/measureScale.js';
import { MOBILE_MEASURE_ITEMS, applyMobileMeasurePick, mobileMeasureItems } from '../src/mobile/mobileShapeRail.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const QUARTER = scaleFromPreset('1/4'); // 18 pt per foot
// 10 ft x 5 ft on a 1/4" = 1' sheet.
const ROOM = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }, { x: 0, y: 90 }];

test('each new kind rides the right drawing tool', () => {
  assert.equal(measureBaseTool('polylength'), 'polyline');
  assert.equal(measureBaseTool('wallArea'), 'polygon');
  assert.equal(measureBaseTool('volume'), 'polygon');
  assert.deepEqual([...DEPTH_MEASURE_KINDS], ['wallArea', 'volume']);
  assert.equal(isPolyMeasureFor('polyline', 'polylength'), true);
  assert.equal(isPolyMeasureFor('polygon', 'polylength'), false);
  assert.equal(isPolyMeasureFor('polygon', 'volume'), true);
  assert.equal(isPolyMeasureFor('polygon', 'area'), true);
  assert.equal(isPolyMeasureFor('line', 'length'), false, 'length commits through the line path, not the poly path');
  assert.equal(isPolyMeasureFor('polygon', null), false);
});

test('polylength reads an open run, with no closing edge', () => {
  const run = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }];
  assert.equal(polylineLengthPt(run), 270);
  assert.deepEqual(polylineMidpoint(run), { x: 135, y: 0 });
  const label = buildMeasureLabel(stampMeasure({ type: 'polyline', points: run }, 'polylength', QUARTER), QUARTER);
  assert.equal(label.kind, 'polylength');
  assert.equal(label.text, '15\' 0"');
  assert.equal(polylineLengthPt([{ x: 1, y: 1 }]), 0);
});

test('wall area is the outline times the depth, volume is the area times the depth', () => {
  const wall = buildMeasureLabel(stampMeasure({ type: 'polygon', points: ROOM }, 'wallArea', QUARTER, { depth: 8 }), QUARTER);
  assert.equal(wall.text, '240.00 sq ft'); // 30 ft of wall x 8 ft
  const vol = buildMeasureLabel(stampMeasure({ type: 'polygon', points: ROOM }, 'volume', QUARTER, { depth: 8 }), QUARTER);
  assert.equal(vol.text, '400.00 cu ft'); // 50 sq ft x 8 ft
  const metric = scaleFromPreset('1:100');
  assert.match(formatMeasureVolume(ROOM_AREA_PT2(), 2, metric), / m³$/);
  assert.match(formatMeasureWallArea(540, 2, null), /\(no scale\)$/);
});

function ROOM_AREA_PT2() { return 180 * 90; }

test('the depth is stamped only on the kinds that use it, and only when usable', () => {
  const v = stampMeasure({ type: 'polygon', points: ROOM }, 'volume', QUARTER, { depth: 2.5 });
  assert.equal(v.data.measure.depth, 2.5);
  const a = stampMeasure({ type: 'polygon', points: ROOM }, 'area', QUARTER, { depth: 2.5 });
  assert.equal('depth' in a.data.measure, false);
  const bad = stampMeasure({ type: 'polygon', points: ROOM }, 'volume', QUARTER, { depth: -1 });
  assert.equal('depth' in bad.data.measure, false);
  assert.equal(normalizeMeasureDepth('0'), null);
  assert.equal(normalizeMeasureDepth('abc'), null);
  assert.equal(normalizeMeasureDepth('3.5'), 3.5);
  // An old save without a depth reads zero, never NaN.
  assert.equal(buildMeasureLabel(bad, QUARTER).text, '0.00 cu ft');
});

test('the last depth is remembered and survives blocked or junk storage', () => {
  const store = new Map();
  const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(loadMeasureDepth(ok), 1);
  rememberMeasureDepth(9, ok);
  assert.equal(store.get(MEASURE_DEPTH_STORAGE_KEY), '9');
  assert.equal(loadMeasureDepth(ok), 9);
  rememberMeasureDepth(0, ok);
  assert.equal(loadMeasureDepth(ok), 9, 'a zero depth is not saved');
  store.set(MEASURE_DEPTH_STORAGE_KEY, 'junk');
  assert.equal(loadMeasureDepth(ok), 1);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadMeasureDepth(blocked), 1);
  assert.doesNotThrow(() => rememberMeasureDepth(4, blocked));
});

test('the phone menu adds the new tools only with the flag, in the desktop order', () => {
  assert.equal(mobileMeasureItems(false), MOBILE_MEASURE_ITEMS);
  assert.deepEqual(mobileMeasureItems(true).map((m) => m.key), ['length', 'polylength', 'area', 'perimeter', 'wallArea', 'volume', 'scale']);
  const calls = [];
  const api = { setActiveTool: (t) => calls.push(['tool', t]), setMeasureMode: (m) => calls.push(['mode', m]) };
  assert.equal(applyMobileMeasurePick('polylength', api), 'polyline');
  assert.equal(applyMobileMeasurePick('volume', api), 'polygon');
  assert.deepEqual(calls, [['tool', 'polyline'], ['mode', 'polylength'], ['tool', 'polygon'], ['mode', 'volume']]);
});

test('the flag is beta and seeded, and the viewer wires the depth', () => {
  assert.equal(FEATURE_FLAGS['measure-depth'].stage, 'beta');
  const migration = readFileSync(new URL('../supabase/migrations/20261109190000_measure_depth_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'measure-depth', 'off'/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /isFeatureOn\('measure-depth'\)/);
  assert.match(viewer, /measureDepth=\{measureDepth\}/);
  assert.match(viewer, /DEPTH_MEASURE_KINDS\.includes\(measureMode\)/);
  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /stampMeasure\(builtJson, measureMode, effectiveMeasureScale, \{ depth: measureDepth \}\)/);
});
