// Measure polish from the Drawboard Projects audit (2026-10-27): perimeter,
// one scale for every page (doc meta), recent scales, the live scale bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addRecentMeasureScale,
  buildMeasureLabel,
  loadRecentMeasureScales,
  measureBaseTool,
  measureScaleBar,
  metaScaleForPage,
  nextMeasureScaleMeta,
  normalizeMeasureScaleMeta,
  polygonPerimeterPt,
  rememberRecentMeasureScale,
  scaleFromPreset,
  stampMeasure,
} from '../src/utils/measure/measureScale.js';

const QUARTER = scaleFromPreset('1/4'); // 18 pt per foot
const EIGHTH = scaleFromPreset('1/8');

test('perimeter rides the polygon tool and reads the outline length', () => {
  assert.equal(measureBaseTool('perimeter'), 'polygon');
  assert.equal(measureBaseTool('area'), 'polygon');
  assert.equal(measureBaseTool('length'), 'line');
  assert.equal(measureBaseTool('calibrate'), 'line');
  const square = [{ x: 0, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 90 }, { x: 0, y: 90 }];
  assert.equal(polygonPerimeterPt(square), 540);
  const label = buildMeasureLabel(stampMeasure({ type: 'polygon', points: square }, 'perimeter', null), QUARTER);
  assert.equal(label.kind, 'perimeter');
  assert.equal(label.text, '30\' 0"'); // 540 pt / 18 pt per ft
});

test('a scale set on all pages reaches every page; one page overrides it', () => {
  let meta = normalizeMeasureScaleMeta(null);
  assert.deepEqual(meta, { all: null, pages: {} });
  meta = nextMeasureScaleMeta(meta, 3, EIGHTH);
  assert.deepEqual(metaScaleForPage(meta, 3), EIGHTH);
  assert.equal(metaScaleForPage(meta, 1), null);
  meta = nextMeasureScaleMeta(meta, 1, QUARTER, { allPages: true });
  // "All pages" replaces every per-page scale.
  assert.deepEqual(meta, { all: QUARTER, pages: {} });
  assert.deepEqual(metaScaleForPage(meta, 7), QUARTER);
  meta = nextMeasureScaleMeta(meta, 2, EIGHTH);
  assert.deepEqual(metaScaleForPage(meta, 2), EIGHTH);
  assert.deepEqual(metaScaleForPage(meta, 5), QUARTER);
});

test('saved meta from another screen is cleaned before use', () => {
  const meta = normalizeMeasureScaleMeta({ all: { ptPerUnit: -1, unit: 'ft' }, pages: { 2: QUARTER, x: QUARTER, 4: { unit: 'parsec', ptPerUnit: 3 } } });
  assert.deepEqual(meta, { all: null, pages: { 2: QUARTER } });
});

test('recent scales keep the last five, newest first, no repeats', () => {
  let list = [];
  for (const id of ['1/16', '1/8', '3/16', '1/4', '3/8', '1/2']) list = addRecentMeasureScale(list, scaleFromPreset(id));
  assert.deepEqual(list.map((s) => s.label), ['1/2" = 1\'', '3/8" = 1\'', '1/4" = 1\'', '3/16" = 1\'', '1/8" = 1\'']);
  list = addRecentMeasureScale(list, scaleFromPreset('1/4'));
  assert.equal(list[0].label, '1/4" = 1\'');
  assert.equal(list.length, 5);
  assert.equal(list.filter((s) => s.label === '1/4" = 1\'').length, 1);
});

test('recent scales survive blocked or junk storage', () => {
  const store = new Map();
  const ok = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  rememberRecentMeasureScale(QUARTER, ok);
  assert.deepEqual(loadRecentMeasureScales(ok), [QUARTER]);
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(loadRecentMeasureScales(blocked), []);
  assert.doesNotThrow(() => rememberRecentMeasureScale(QUARTER, blocked));
  store.set('survey:measure-recent-scales', '{not json');
  assert.deepEqual(loadRecentMeasureScales(ok), []);
});

test('the scale bar picks a round length near the target screen size', () => {
  // 1/4" = 1' at 100% zoom (1 pt per px): 120 px is 6.67 ft -> 5 ft bar.
  assert.deepEqual(measureScaleBar(QUARTER, 1), { real: 5, lengthPt: 90, text: '5\'' });
  // Zoomed out 4x (4 pt per px): 26.7 ft -> 20 ft.
  assert.equal(measureScaleBar(QUARTER, 4).text, '20\'');
  const metric = scaleFromPreset('1:100');
  const bar = measureScaleBar(metric, 1);
  assert.match(bar.text, /^\d+(\.\d+)? m$/);
  assert.ok(bar.lengthPt <= 120 && bar.lengthPt > 40);
  assert.equal(measureScaleBar(null, 1), null);
});

test('viewer and dialog wire the new pieces', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /subscribeDocumentMeta\(MEASURE_SCALES_META_KEY, apply\)/);
  assert.match(viewer, /\{ key: 'perimeter', label: 'Perimeter', iconName: 'measurePerimeter' \}/);
  const dialog = readFileSync(new URL('../src/components/MeasureScaleDialog.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /onApply\(scale, \{ allPages: allPages && pageCount > 1 \}\)/);
  assert.match(dialog, /aria-label="Recent scale"/);
});
