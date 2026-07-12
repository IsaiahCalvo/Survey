import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampScale,
  ZOOM_MODES,
  DEFAULT_ZOOM_PREFERENCES,
  loadZoomPreferences,
  saveZoomPreferences,
  createZoomController,
} from '../src/utils/zoomController.js';

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

test('load/saveZoomPreferences round-trip through localStorage', () => {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
    },
  };
  try {
    assert.deepEqual(loadZoomPreferences(), { ...DEFAULT_ZOOM_PREFERENCES });
    saveZoomPreferences({ mode: ZOOM_MODES.FIT_WIDTH, manualScale: 2.5 });
    assert.deepEqual(loadZoomPreferences(), {
      mode: ZOOM_MODES.FIT_WIDTH,
      manualScale: 2.5,
    });
    saveZoomPreferences({ mode: 'nope', manualScale: 99 });
    assert.equal(loadZoomPreferences().mode, DEFAULT_ZOOM_PREFERENCES.mode);
    assert.equal(loadZoomPreferences().manualScale, 40);
  } finally {
    delete globalThis.window;
  }
});

test('loadZoomPreferences falls back without window or on corrupt JSON', () => {
  assert.deepEqual(loadZoomPreferences(), { ...DEFAULT_ZOOM_PREFERENCES });
  globalThis.window = {
    localStorage: {
      getItem() { return '{'; },
      setItem() {},
    },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(loadZoomPreferences(), { ...DEFAULT_ZOOM_PREFERENCES });
  } finally {
    console.warn = originalWarn;
    delete globalThis.window;
  }
});

test('createZoomController applies fit modes and manual scale changes', () => {
  const scales = [];
  const modes = [];
  const manuals = [];
  const persisted = [];
  const controller = createZoomController({
    initialMode: ZOOM_MODES.FIT_PAGE,
    getViewportSize: () => ({ width: 800, height: 600 }),
    getPageSize: () => ({ width: 400, height: 800 }),
    setScale: (s) => scales.push(s),
    onModeChange: (m) => modes.push(m),
    onManualScaleChange: (s) => manuals.push(s),
    persistPreferences: (p) => persisted.push(p),
  });

  assert.equal(controller.applyZoom(), 0.75); // min(800/400, 600/800)
  assert.equal(controller.setMode(ZOOM_MODES.FIT_WIDTH), 2);
  assert.equal(controller.setMode(ZOOM_MODES.FIT_HEIGHT), 0.75);
  assert.equal(controller.setScale(3.5), 3.5);
  assert.equal(controller.getMode(), ZOOM_MODES.MANUAL);
  assert.equal(controller.getManualScale(), 3.5);
  assert.ok(modes.includes(ZOOM_MODES.MANUAL));
  assert.ok(manuals.includes(3.5));
  assert.ok(persisted.length > 0);
  assert.equal(controller.setMode('invalid'), 3.5);
});

test('zoom preferences save/load catch paths and fit-mode null dimensions', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => saveZoomPreferences({ mode: ZOOM_MODES.MANUAL, manualScale: 2 }));

    globalThis.window = {
      localStorage: {
        getItem() { throw new Error('denied'); },
        setItem() { throw new Error('denied'); },
      },
    };
    assert.deepEqual(loadZoomPreferences(), { ...DEFAULT_ZOOM_PREFERENCES });
    assert.doesNotThrow(() => saveZoomPreferences({ mode: ZOOM_MODES.FIT_WIDTH, manualScale: 1.2 }));
  } finally {
    console.warn = originalWarn;
    delete globalThis.window;
  }

  const scales = [];
  const manuals = [];
  const controller = createZoomController({
    initialMode: ZOOM_MODES.FIT_PAGE,
    getViewportSize: () => ({ width: 800, height: 600 }),
    getPageSize: () => ({ width: 0, height: 0 }),
    setScale: (s) => scales.push(s),
    onManualScaleChange: (s) => manuals.push(s),
  });
  // Both width/height scales null → default manual scale
  assert.equal(controller.applyZoom({ persist: false }), DEFAULT_ZOOM_PREFERENCES.manualScale);

  const widthOnly = createZoomController({
    initialMode: ZOOM_MODES.FIT_PAGE,
    getViewportSize: () => ({ width: 800, height: 0 }),
    getPageSize: () => ({ width: 400, height: 0 }),
    setScale: () => {},
  });
  assert.equal(widthOnly.applyZoom({ persist: false }), 2);

  const heightOnly = createZoomController({
    initialMode: ZOOM_MODES.FIT_PAGE,
    getViewportSize: () => ({ width: 0, height: 600 }),
    getPageSize: () => ({ width: 0, height: 300 }),
    setScale: () => {},
  });
  assert.equal(heightOnly.applyZoom({ persist: false }), 2);

  const manual = createZoomController({
    initialMode: ZOOM_MODES.MANUAL,
    initialManualScale: 1.5,
    setScale: (s) => scales.push(s),
    onManualScaleChange: (s) => manuals.push(s),
  });
  assert.equal(manual.setMode(ZOOM_MODES.MANUAL, { scale: 2.25, persist: false }), 2.25);
  assert.equal(manual.applyZoom({ scale: 2.5, persist: false, skipApply: false }), 2.5);
  assert.equal(manual.setMode(ZOOM_MODES.FIT_WIDTH, { skipApply: true, persist: false }), 2.5);
});

test('applyZoom handles null viewport/pageSize and mode switch via context', () => {
  const nullDims = createZoomController({
    initialMode: ZOOM_MODES.FIT_PAGE,
    getViewportSize: () => null,
    getPageSize: () => ({ width: 400, height: 800 }),
    setScale: () => {},
  });
  assert.equal(nullDims.applyZoom({ persist: false }), DEFAULT_ZOOM_PREFERENCES.manualScale);

  const noPage = createZoomController({
    initialMode: ZOOM_MODES.FIT_WIDTH,
    getViewportSize: () => ({ width: 800, height: 600 }),
    getPageSize: () => null,
    setScale: () => {},
  });
  assert.equal(noPage.applyZoom({ persist: false }), DEFAULT_ZOOM_PREFERENCES.manualScale);

  const scales = [];
  const ctl = createZoomController({
    initialMode: ZOOM_MODES.MANUAL,
    initialManualScale: 1.25,
    getViewportSize: () => ({ width: 800, height: 600 }),
    getPageSize: () => ({ width: 400, height: 800 }),
    setScale: (s) => scales.push(s),
  });
  assert.equal(ctl.applyZoom({ mode: ZOOM_MODES.FIT_WIDTH, persist: false }), 2);
  assert.ok(scales.includes(2));
});
