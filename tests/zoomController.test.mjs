import test from 'node:test';
import assert from 'node:assert/strict';
import { clampScale, createZoomController, ZOOM_MODES } from '../src/utils/zoomController.js';

test('clampScale accepts 0.01 as the zoom floor', () => {
  assert.equal(clampScale(0.01), 0.01);
});

test('clampScale clamps values below the 0.01 floor', () => {
  assert.equal(clampScale(0.005), 0.01);
});

test('clampScale leaves 0.1 untouched', () => {
  assert.equal(clampScale(0.1), 0.1);
});

test('clampScale leaves 0.5 untouched', () => {
  assert.equal(clampScale(0.5), 0.5);
});

test('clampScale leaves 5.0 ceiling untouched', () => {
  assert.equal(clampScale(5.0), 5.0);
});

test('clampScale leaves the PDF engine 40.0 ceiling untouched', () => {
  assert.equal(clampScale(40.0), 40.0);
});

test('clampScale clamps 41.0 down to the PDF engine 40.0 ceiling', () => {
  assert.equal(clampScale(41.0), 40.0);
});

test('clampScale returns DEFAULT manualScale (1.0) for NaN input', () => {
  assert.equal(clampScale(NaN), 1.0);
});

test('clampScale returns DEFAULT manualScale (1.0) for non-number input', () => {
  assert.equal(clampScale('not a number'), 1.0);
});

test('controller stores and applies the viewer-provided document minimum', () => {
  let appliedScale = null;
  const controller = createZoomController({
    initialManualScale: 1,
    getMinimumScale: () => 0.78,
    setScale: (scale) => { appliedScale = scale; },
    persistPreferences: () => {},
  });

  assert.equal(controller.setScale(0.1), 0.78);
  assert.equal(controller.getManualScale(), 0.78);
  assert.equal(appliedScale, 0.78);
});

test('controller refreshes and persists a minimum that becomes known after startup', () => {
  let minimumScale = 0.01;
  let appliedScale = null;
  const persisted = [];
  const controller = createZoomController({
    initialMode: ZOOM_MODES.MANUAL,
    initialManualScale: 0.01,
    getMinimumScale: () => minimumScale,
    setScale: (scale) => { appliedScale = scale; },
    persistPreferences: (preferences) => { persisted.push(preferences); },
  });

  minimumScale = 0.78;
  controller.applyZoom();

  assert.equal(appliedScale, 0.78);
  assert.equal(controller.getManualScale(), 0.78);
  assert.equal(persisted.at(-1).manualScale, 0.78);
});
