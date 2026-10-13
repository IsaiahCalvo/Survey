// Owner 2026-10-13: the Smart fill slot (src/survey/markerShapeProviders.js)
// and the remembered marker draw mode (src/survey/markerDrawMode.js).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const providers = await import('../src/survey/markerShapeProviders.js');
const drawMode = await import('../src/survey/markerDrawMode.js');
const { registerDevFakeSmartFillProvider } = await import('../src/survey/devFakeSmartFillProvider.js');
const { buildPolygonMarkerBounds } = await import('../src/survey/markerShapes.js');

beforeEach(() => {
  store.clear();
  providers.resetMarkerShapeProvidersForTests();
  drawMode.resetMarkerDrawModeForTests();
});

test('register / replace / unregister, with change notices', () => {
  let notices = 0;
  const off = providers.subscribeMarkerShapeProviders(() => { notices += 1; });
  const unregister = providers.registerMarkerShapeProvider({ id: 'smartFill', label: 'Smart fill', onPagePointerDown: async () => null });
  assert.equal(providers.getMarkerShapeProvider('smartFill').label, 'Smart fill');
  assert.equal(providers.getMarkerShapeProvider('smartFill').icon, 'paintBucket', 'default icon');
  const first = providers.getMarkerShapeProviders();
  assert.equal(first, providers.getMarkerShapeProviders(), 'stable snapshot between changes');
  const unregisterB = providers.registerMarkerShapeProvider({ id: 'smartFill', label: 'B', onPagePointerDown: async () => null });
  assert.equal(providers.getMarkerShapeProvider('smartFill').label, 'B', 'a second register replaces');
  unregister(); // the replaced one's unregister must not remove B
  assert.equal(providers.getMarkerShapeProvider('smartFill').label, 'B');
  unregisterB();
  assert.equal(providers.getMarkerShapeProvider('smartFill'), null);
  assert.equal(notices, 3);
  off();
});

test('a malformed provider is refused loudly', () => {
  assert.throws(() => providers.registerMarkerShapeProvider(null));
  assert.throws(() => providers.registerMarkerShapeProvider({ id: '', onPagePointerDown() {} }));
  assert.throws(() => providers.registerMarkerShapeProvider({ id: 'smartFill' }));
});

test('runMarkerShapeProvider hands over the page, the point and the pdf.js page', async () => {
  let seen = null;
  providers.registerMarkerShapeProvider({
    id: 'smartFill',
    onPagePointerDown: async (ctx) => { seen = ctx; return { polygons: [[[0, 0], [10, 0], [10, 10]]] }; },
  });
  const fakePage = { getViewport: ({ scale }) => ({ scale, width: 612, height: 792 }) };
  providers.setMarkerShapePdfDocument({ getPage: async (n) => (n === 3 ? fakePage : null) });
  const result = await providers.runMarkerShapeProvider('smartFill', {
    pageNumber: 3, point: { x: 12, y: 34 }, pageSize: { width: 612, height: 792 }, pageCanvas: 'canvas',
  });
  assert.ok(result.polygons);
  assert.equal(seen.pageIndex, 2);
  assert.equal(seen.pageNumber, 3);
  assert.deepEqual(seen.point, { x: 12, y: 34 });
  assert.equal(seen.pdfPage, fakePage);
  assert.equal(seen.viewport.scale, 1);
  assert.equal(seen.pageCanvas, 'canvas');
});

test('runMarkerShapeProvider: no provider, a failing provider and an aborted press all give null', async () => {
  assert.equal(await providers.runMarkerShapeProvider('smartFill', { pageNumber: 1, point: { x: 0, y: 0 } }), null);
  const warn = console.warn;
  console.warn = () => {};
  try {
    providers.registerMarkerShapeProvider({ id: 'smartFill', onPagePointerDown: async () => { throw new Error('boom'); } });
    assert.equal(await providers.runMarkerShapeProvider('smartFill', { pageNumber: 1, point: { x: 0, y: 0 } }), null);
  } finally {
    console.warn = warn;
  }
  providers.registerMarkerShapeProvider({ id: 'smartFill', onPagePointerDown: async () => ({ polygons: [[[0, 0], [9, 0], [9, 9]]] }) });
  const controller = new AbortController();
  const pending = providers.runMarkerShapeProvider('smartFill', { pageNumber: 1, point: { x: 0, y: 0 }, signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
});

test('the dev fake provider returns a polygon with a hole that becomes a marker', async () => {
  globalThis.window = globalThis.window || {};
  registerDevFakeSmartFillProvider();
  const result = await providers.runMarkerShapeProvider('smartFill', { pageNumber: 1, point: { x: 200, y: 300 } });
  const bounds = buildPolygonMarkerBounds(result);
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [140, 260, 120, 80]);
  assert.equal(bounds.shape.polygons[0].length, 2);
  assert.equal(globalThis.window.__fakeSmartFillCalls.length, 1);
});

test('draw mode: remembered, and Rectangle wherever no picker is on screen', () => {
  assert.equal(drawMode.getShownMarkerDrawMode(), 'rectangle', 'default');
  drawMode.setMarkerDrawMode('freehand');
  assert.equal(store.get(drawMode.MARKER_DRAW_MODE_STORAGE_KEY), 'freehand');
  assert.equal(drawMode.getShownMarkerDrawMode(), 'freehand');
  assert.equal(drawMode.getEffectiveMarkerDrawMode(), 'rectangle', 'no picker (phone): rectangle');
  drawMode.setMarkerModeToolsShown(true);
  assert.equal(drawMode.getEffectiveMarkerDrawMode(), 'freehand');
  drawMode.setMarkerModeToolsShown(false);
  assert.equal(drawMode.getEffectiveMarkerDrawMode(), 'rectangle');
  drawMode.resetMarkerDrawModeForTests();
  assert.equal(drawMode.getPickedMarkerDrawMode(), 'freehand', 'read back from storage');
  drawMode.setMarkerDrawMode('nonsense');
  assert.equal(drawMode.getPickedMarkerDrawMode(), 'freehand');
});

test('draw mode: Smart fill only counts while its provider is registered', () => {
  drawMode.setMarkerModeToolsShown(true);
  drawMode.setMarkerDrawMode('smartFill');
  assert.equal(drawMode.isMarkerDrawModeAvailable('smartFill'), false);
  assert.equal(drawMode.getShownMarkerDrawMode(), 'rectangle', 'no provider: Rectangle is lit');
  const off = providers.registerMarkerShapeProvider({ id: 'smartFill', onPagePointerDown: async () => null });
  assert.equal(drawMode.getEffectiveMarkerDrawMode(), 'smartFill');
  off();
  assert.equal(drawMode.getEffectiveMarkerDrawMode(), 'rectangle');
  assert.equal(drawMode.getPickedMarkerDrawMode(), 'smartFill', 'the pick comes back when the provider does');
  drawMode.setMarkerModeToolsShown(false);
});

// Codex on #817: a Smart fill answer that arrives after the person switched to
// Rectangle / Freehand, another tool, or another document tab must not add a
// marker.
test('a pending Smart fill press stays live only while Smart fill is still what is armed, in the tab in front', () => {
  const live = (over = {}) => providers.isSmartFillPressLive({
    activeTool: 'survey-marker', markerDrawMode: 'smartFill', isTabActive: true, ...over,
  });
  assert.equal(live(), true);
  assert.equal(live({ isTabActive: undefined }), true, 'a layer without the prop counts as in front');
  assert.equal(live({ markerDrawMode: 'rectangle' }), false);
  assert.equal(live({ markerDrawMode: 'freehand' }), false);
  assert.equal(live({ activeTool: 'pan' }), false);
  assert.equal(live({ isTabActive: false }), false);

  const layer = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(layer, /isSmartFillPressLive\(\{ activeTool, markerDrawMode, isTabActive \}\)/);
  assert.match(layer, /if \(!smartFillLive\) smartFillAbortRef\.current\?\.abort\?\.\(\);/, 'the press is aborted when it stops applying');
  assert.match(layer, /if \(controller\?\.signal\?\.aborted \|\| !smartFillLiveRef\.current\) return;/, 'a late answer is dropped');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /<SVGAnnotationLayer[\s\S]{0,300}isTabActive=\{isActive !== false\}/, 'the viewer tells the layer whether its tab is in front');
});
