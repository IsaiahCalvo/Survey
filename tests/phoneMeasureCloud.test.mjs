import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MOBILE_MEASURE_ITEMS, isMobileShapeToolActive, applyMobileShapePick, applyMobileMeasurePick,
} from '../src/mobile/mobileShapeRail.js';

const api = () => {
  const calls = [];
  const rec = (n) => (...a) => calls.push([n, ...a]);
  return { calls, lineBorderStyle: 'solid', pageNum: 3, setToolLineBorderStyle: rec('style'), setLineBorderStyle: rec('selection-restyle'), setMeasureMode: rec('mode'), setActiveTool: rec('tool'), openMeasureScaleDialog: rec('dialog') };
};

test('phone Shapes strip offers Cloud and Measure', () => {
  assert.deepEqual(MOBILE_MEASURE_ITEMS.map((m) => m.key), ['length', 'area', 'scale']);
  const chrome = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');
  assert.match(chrome, /\{ id: 'cloud', label: 'Cloud', icon: 'shapeCloud' \}/);
  assert.match(chrome, /\{ id: 'measure', label: 'Measure', icon: 'measureScale', measure: true \}/);
});

test('Cloud arms rect + cloud style and clears measure mode', () => {
  const a = api();
  assert.equal(applyMobileShapePick('cloud', a), 'rect');
  assert.deepEqual(a.calls, [['style', 'cloud'], ['mode', null]]);
  assert.equal(isMobileShapeToolActive('cloud', { activeTool: 'rect', lineBorderStyle: 'cloud' }), true);
  assert.equal(isMobileShapeToolActive('rect', { activeTool: 'rect', lineBorderStyle: 'cloud' }), false);
});

test('Measure picks arm line/polygon or open the scale dialog for the current page', () => {
  const a = api();
  assert.equal(applyMobileMeasurePick('length', a), 'line');
  assert.deepEqual(a.calls, [['tool', 'line'], ['mode', 'length']]);
  // Never restyle the selected annotation (it un-clouded a just-drawn cloud).
  const c = api(); c.lineBorderStyle = 'cloud';
  applyMobileMeasurePick('area', c); applyMobileShapePick('rect', c);
  assert.ok(!c.calls.some(([n]) => n === 'selection-restyle'));
  const b = api();
  applyMobileMeasurePick('scale', b);
  assert.deepEqual(b.calls, [['dialog', { pageNumber: 3 }]]);
  assert.equal(isMobileShapeToolActive('line', { activeTool: 'line', measureMode: 'length' }), false);
  assert.equal(isMobileShapeToolActive('measure', { activeTool: 'line', measureMode: 'length' }), true);
});

test('Set page scale dialog has 44px targets and 16px fields', () => {
  const src = readFileSync(new URL('../src/components/MeasureScaleDialog.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /minHeight: (3\d|4[0-3])\b/);
  assert.match(src, /fontSize: 16/);
});

test('PDFViewer publishes measure state to the phone chrome', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /openMeasureScaleDialog: setMeasureScaleDialog/);
  assert.match(src, /measureScaleDialogOpen: !!measureScaleDialog/);
  assert.match(src, /setToolLineBorderStyle: setLineBorderStyle/);
});
