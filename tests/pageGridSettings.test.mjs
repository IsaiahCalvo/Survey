import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_GRID_STEP_PT,
  applyPageGridPageSteps,
  normalizePageGridSettings,
  pageGridBaseStepPt,
  pageGridStepForScale,
  pageGridUsesDrawingScale,
} from '../src/utils/pageGrid.js';

test('density presets: fine, normal, wide in paper inches', () => {
  assert.equal(pageGridBaseStepPt({ density: 'fine' }), 18);
  assert.equal(pageGridBaseStepPt({ density: 'normal' }), PAGE_GRID_STEP_PT);
  assert.equal(pageGridBaseStepPt({ density: 'wide' }), 72);
  assert.equal(pageGridBaseStepPt(null), PAGE_GRID_STEP_PT, 'nothing saved keeps the half inch');
});

test('custom paper spacing in inches and millimetres, clamped', () => {
  assert.equal(pageGridBaseStepPt({ density: 'custom', customValue: 2, customUnit: 'in' }), 144);
  assert.ok(Math.abs(pageGridBaseStepPt({ density: 'custom', customValue: 10, customUnit: 'mm' }) - 28.346) < 0.01);
  assert.equal(pageGridBaseStepPt({ density: 'custom', customValue: 0.001, customUnit: 'in' }), 2);
  assert.equal(pageGridBaseStepPt({ density: 'custom', customValue: 100, customUnit: 'in' }), 720);
});

test('custom drawing spacing follows the page scale', () => {
  const s = { density: 'custom', customValue: 5, customUnit: 'ft' };
  assert.equal(pageGridUsesDrawingScale(s), true);
  // 1/4" = 1': 18 pt per foot, so 5 ft = 90 pt.
  assert.equal(pageGridStepForScale(s, { ptPerUnit: 18, unit: 'ft' }), 90);
  // A scale held in inches works too: 1.5 pt per inch = 18 pt per foot.
  assert.equal(pageGridStepForScale(s, { ptPerUnit: 1.5, unit: 'in' }), 90);
  // Metres on a 1:100 sheet: 1 m = 1000/100 mm of paper = 28.35 pt.
  const m = pageGridStepForScale({ density: 'custom', customValue: 1, customUnit: 'm' }, { ptPerUnit: 28.3465, unit: 'm' });
  assert.ok(Math.abs(m - 28.3465) < 0.001);
  assert.equal(pageGridStepForScale(s, null), null, 'no scale: the page keeps the base');
  assert.equal(pageGridBaseStepPt(s), PAGE_GRID_STEP_PT);
  assert.equal(pageGridStepForScale({ density: 'fine' }, { ptPerUnit: 18, unit: 'ft' }), null);
});

test('bad saved values fall back', () => {
  assert.deepEqual(normalizePageGridSettings({ density: 'huge', customValue: -1, customUnit: 'parsec' }), { density: 'normal', customValue: 5, customUnit: 'ft' });
});

test('page divs get their own step only for drawing sizes', () => {
  const divs = [1, 2].map((n) => {
    const props = new Map();
    return { n, props, getAttribute: () => String(n), style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
  });
  const container = { querySelectorAll: () => divs };
  const scales = { 1: { ptPerUnit: 18, unit: 'ft' } };
  applyPageGridPageSteps({ density: 'custom', customValue: 5, customUnit: 'ft' }, (n) => scales[n] || null, container);
  assert.equal(divs[0].props.get('--page-grid-pt'), '90');
  assert.equal(divs[1].props.has('--page-grid-pt'), false);
  applyPageGridPageSteps({ density: 'wide' }, (n) => scales[n] || null, container);
  assert.equal(divs[0].props.has('--page-grid-pt'), false);
});

// Codex review on #1211: hidden tabs keep their PDFViewer mounted, so each
// viewer sets drawing-unit steps on its own pages only.
test('each viewer sets grid steps on its own pages, not every open tab', async () => {
  const { readFileSync } = await import('node:fs');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const call = viewer.slice(viewer.indexOf('applyPageGridPageSteps(gridSettings'));
  assert.match(call.slice(0, 400), /\), container\);/);
  assert.match(viewer, /const container = pdfjsWrapperRef\.current;\n\s+if \(!gridSettingsEnabled \|\| !container\) return;/);
});

test('spacing slider: log scale per unit, round trips, tidy values', async () => {
  const { pageGridSliderPosition, pageGridSliderValue, pageGridPresetValue } = await import('../src/utils/pageGrid.js');
  for (const [v, unit] of [[0.5, 'in'], [2, 'in'], [10, 'mm'], [5, 'ft'], [1, 'm']]) {
    assert.equal(pageGridSliderValue(pageGridSliderPosition(v, unit), unit), v);
  }
  assert.equal(pageGridSliderPosition(0, 'in'), 0);
  assert.equal(pageGridSliderPosition(1e6, 'in'), 1000);
  assert.equal(pageGridPresetValue('wide', 'in'), 1);
  assert.equal(pageGridPresetValue('fine', 'mm'), 6.35);
  assert.equal(pageGridPresetValue('normal', 'ft'), null);
});

// Owner 2026-11-10: sliding was "very snappy ... jittery". The thumb's value
// is tidy (0.1 in steps above an inch, a 10% jump each), so the page must draw
// an unrounded value that moves in small steps, eased toward the thumb.
test('spacing slider: the page follows an unrounded, eased value', async () => {
  const { pageGridSliderRawValue, pageGridSliderValue } = await import('../src/utils/pageGrid.js');
  let worst = 0;
  for (let p = 600; p < 1000; p += 1) {
    const step = pageGridSliderRawValue(p + 1, 'in') / pageGridSliderRawValue(p, 'in');
    worst = Math.max(worst, step);
  }
  assert.ok(worst < 1.006, `one slider step moves the grid ${((worst - 1) * 100).toFixed(2)}%, under 0.6%`);
  assert.ok(Math.abs(pageGridSliderRawValue(700, 'in') - pageGridSliderValue(700, 'in')) / pageGridSliderValue(700, 'in') < 0.05);
  const { readFileSync } = await import('node:fs');
  const panel = readFileSync(new URL('../src/components/PageGridSettings.jsx', import.meta.url), 'utf8');
  assert.match(panel, /smooth\.to\(pageGridSliderRawValue\(event\.target\.value, unit\)/, 'a slide eases the preview toward the raw value');
  assert.match(panel, /prefers-reduced-motion: reduce/, 'reduced motion goes straight there');
  assert.match(panel, /commitValue\(value, \{ glide: true \}\)/, 'release glides to the tidy saved value');
});
