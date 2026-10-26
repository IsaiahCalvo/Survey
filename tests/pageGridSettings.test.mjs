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
