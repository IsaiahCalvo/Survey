import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stampNewMarksByPage,
  DEFAULT_LAYER_ID,
  addLayer,
  calloutsWithoutHiddenLayers,
  deleteLayer,
  hiddenLayerIdSet,
  isOnHiddenLayer,
  nextLayerName,
  normalizeLayerState,
  renameLayer,
  resolveActiveLayerId,
  resolveLayerId,
  setLayerVisible,
  setPdfOpacity,
  stampNewObjectsOnLayer,
  withoutHiddenLayers,
} from '../src/utils/layers.js';
import { isAnnotationVisibleInContext } from '../src/utils/annotationVisibilityRules.js';
import { FEATURE_FLAGS, isFeatureOn } from '../src/featureFlags.js';

test('missing or junk meta normalizes to just the default layer at full opacity', () => {
  for (const value of [null, undefined, 'x', {}, { layers: 'no' }]) {
    const state = normalizeLayerState(value);
    assert.equal(state.layers.length, 1);
    assert.equal(state.layers[0].id, DEFAULT_LAYER_ID);
    assert.equal(state.layers[0].visible, true);
    assert.equal(state.pdfOpacity, 1);
  }
});

test('normalize drops duplicate / empty ids, trims names, clamps opacity', () => {
  const state = normalizeLayerState({
    layers: [{ id: 'a', name: '  Walls  ' }, { id: 'a', name: 'dup' }, { id: '', name: 'x' }, { id: 'b', name: '', visible: false }],
    pdfOpacity: 7,
  });
  assert.deepEqual(state.layers.map((l) => l.id), [DEFAULT_LAYER_ID, 'a', 'b']);
  assert.equal(state.layers[1].name, 'Walls');
  assert.equal(state.layers[2].name, 'Layer');
  assert.equal(state.layers[2].visible, false);
  assert.equal(state.pdfOpacity, 1);
  assert.equal(setPdfOpacity(state, -1).pdfOpacity, 0);
  assert.equal(setPdfOpacity(state, 0.4).pdfOpacity, 0.4);
});

test('add, rename, hide and delete layers', () => {
  let { state, layer } = addLayer(null, { id: 'l1' });
  assert.equal(layer.name, 'Layer 1');
  assert.equal(nextLayerName(state), 'Layer 2');
  state = renameLayer(state, 'l1', 'Electrical');
  assert.equal(state.layers.find((l) => l.id === 'l1').name, 'Electrical');
  state = renameLayer(state, 'l1', '   ');
  assert.equal(state.layers.find((l) => l.id === 'l1').name, 'Electrical', 'blank rename keeps the name');
  state = setLayerVisible(state, 'l1', false);
  assert.equal(state.layers.find((l) => l.id === 'l1').visible, false);
  assert.equal(deleteLayer(state, DEFAULT_LAYER_ID).layers.length, 2, 'default layer cannot be deleted');
  state = deleteLayer(state, 'l1');
  assert.deepEqual(state.layers.map((l) => l.id), [DEFAULT_LAYER_ID]);
});

test('marks without a layer, or on a deleted layer, belong to the default layer', () => {
  const state = addLayer(null, { id: 'l1' }).state;
  assert.equal(resolveLayerId({}, state), DEFAULT_LAYER_ID);
  assert.equal(resolveLayerId({ layerId: 'l1' }, state), 'l1');
  assert.equal(resolveLayerId({ layerId: 'gone' }, state), DEFAULT_LAYER_ID);
  assert.equal(resolveActiveLayerId(state, 'gone'), DEFAULT_LAYER_ID);
  assert.equal(resolveActiveLayerId(state, 'l1'), 'l1');
});

test('hidden set: null when all show; hiding default hides untagged and orphaned marks', () => {
  let state = addLayer(null, { id: 'l1' }).state;
  assert.equal(hiddenLayerIdSet(state), null);
  state = setLayerVisible(state, 'l1', false);
  let hidden = hiddenLayerIdSet(state);
  assert.equal(isOnHiddenLayer({ layerId: 'l1' }, hidden), true);
  assert.equal(isOnHiddenLayer({}, hidden), false);
  state = setLayerVisible(setLayerVisible(state, 'l1', true), DEFAULT_LAYER_ID, false);
  hidden = hiddenLayerIdSet(state);
  assert.equal(isOnHiddenLayer({}, hidden), true);
  assert.equal(isOnHiddenLayer({ layerId: 'deleted-layer' }, hidden), true);
  assert.equal(isOnHiddenLayer({ layerId: 'l1' }, hidden), false);
  assert.equal(isOnHiddenLayer({ layerId: 'l1' }, null), false);
});

test('visibility rules drop marks on hidden layers (render + hit-test + thumbnails)', () => {
  const hidden = hiddenLayerIdSet(setLayerVisible(addLayer(null, { id: 'l1' }).state, 'l1', false));
  assert.equal(isAnnotationVisibleInContext({ annotation: { type: 'rect', layerId: 'l1' }, pageNumber: 1, hiddenLayerIds: hidden }), false);
  assert.equal(isAnnotationVisibleInContext({ annotation: { type: 'rect' }, pageNumber: 1, hiddenLayerIds: hidden }), true);
  assert.equal(isAnnotationVisibleInContext({ annotation: { type: 'rect', layerId: 'l1' }, pageNumber: 1 }), true);
});

test('only new marks are stamped with the active layer', () => {
  const before = [{ id: 'a' }, { data: { id: 'b' } }];
  const after = [{ id: 'a' }, { data: { id: 'b' } }, { id: 'c' }, { id: 'd', layerId: 'other' }, { type: 'no-id' }];
  const out = stampNewObjectsOnLayer(before, after, 'l1');
  assert.equal(out[0].layerId, undefined);
  assert.equal(out[1].layerId, undefined);
  assert.equal(out[2].layerId, 'l1');
  assert.equal(out[3].layerId, 'other');
  assert.equal(out[4].layerId, undefined);
  assert.equal(stampNewObjectsOnLayer(before, after, DEFAULT_LAYER_ID), after, 'default layer leaves marks untagged');
  assert.equal(stampNewObjectsOnLayer(before, before, 'l1'), before, 'nothing new returns the same array');
});

test('export copies leave hidden layers out without touching the originals', () => {
  const hidden = hiddenLayerIdSet(setLayerVisible(addLayer(null, { id: 'l1' }).state, 'l1', false));
  const byPage = { 1: { objects: [{ id: 'a' }, { id: 'b', layerId: 'l1' }] }, 2: null };
  const out = withoutHiddenLayers(byPage, hidden);
  assert.deepEqual(out[1].objects.map((o) => o.id), ['a']);
  assert.equal(out[2], null);
  assert.equal(byPage[1].objects.length, 2);
  assert.equal(withoutHiddenLayers(byPage, null), byPage);
  assert.deepEqual(calloutsWithoutHiddenLayers([{ id: 'x' }, { id: 'y', layerId: 'l1' }], hidden).map((c) => c.id), ['x']);
});

test("'layers' flag exists and is off by default", () => {
  assert.ok(FEATURE_FLAGS.layers);
  assert.equal(isFeatureOn('layers', { storage: null, env: {} }), false);
});

test('a callout keeps its layer through the page-object projection and back', async () => {
  const { projectCalloutsIntoByPage, deriveCalloutsFromByPage } = await import('../src/utils/calloutAnnotationBridge.js');
  const callout = {
    id: 'callout-layer-1',
    pageNumber: 1,
    arrowTip: { x: 0.1, y: 0.2 },
    knee: { x: 0.2, y: 0.2 },
    textBoxPosition: { x: 0.3, y: 0.2 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: 'Callout',
    layerId: 'layer-a',
  };
  const byPage = projectCalloutsIntoByPage({ 1: { objects: [] } }, [callout], { 1: { width: 612, height: 792 } });
  const stored = byPage[1].objects.find((o) => o?.data?.type === 'callout');
  assert.equal(stored.layerId, 'layer-a');
  // A layer stamped on the stored object (the page save seam) reaches the callout.
  const restamped = { 1: { objects: [{ ...stored, layerId: 'layer-b' }] } };
  assert.equal(deriveCalloutsFromByPage(restamped)[0].layerId, 'layer-b');
  const hidden = hiddenLayerIdSet({ layers: [{ id: 'layer-b', name: 'B', visible: false }] });
  assert.deepEqual(calloutsWithoutHiddenLayers(deriveCalloutsFromByPage(restamped), hidden), []);
});

test('wiring: every mark save, the eraser, print and the review bundle honor layers', async () => {
  const { readFileSync } = await import('node:fs');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const eraser = readFileSync(new URL('../src/components/FabricEraserCanvas.jsx', import.meta.url), 'utf8');
  // The page save seam tags marks new to the page (counter, stamp, paste, text).
  assert.match(viewer, /stampNewObjectsOnLayer\(annotationsByPageRef\.current\?\.\[pageNumber\]\?\.objects, json\.objects, activeLayerIdRef\.current\)/);
  // Hidden-layer ink is immune to the eraser.
  assert.match(eraser, /isOnHiddenLayer\(object, hiddenLayerIdsRef\.current\)\) return 'hidden-layer'/);
  assert.match(viewer, /hiddenLayerIds=\{hiddenLayerIds\}\n\s+zoomGeneration=\{zoomGeneration\}/);
  // Print and the review bundle skip hidden layers like Export PDF / XFDF.
  assert.match(viewer, /annotationsByPage: withoutHiddenLayers\(printableAnnotationsByPageRef\.current \|\| \{\}, hiddenLayerIdsRef\.current\)/);
  assert.equal((viewer.match(/annotationsByPage: withoutHiddenLayers\(annotationsByPage, hiddenLayerIds\)/g) || []).length, 2);
});

test('text-markup transactions: new highlight groups on any page get the active layer', () => {
  const prev = { 1: { objects: [{ data: { id: 'old' } }] } };
  const hl = { type: 'group', data: { id: 'hl1', textMarkupType: 'highlight' } };
  const ul = { type: 'group', data: { id: 'ul1', textMarkupType: 'underline' } };
  const next = { 1: { objects: [{ data: { id: 'old' } }, hl] }, 2: { objects: [ul] } };
  const out = stampNewMarksByPage(prev, next, 'L2');
  assert.equal(out[1].objects[0].layerId, undefined);
  assert.equal(out[1].objects[1].layerId, 'L2');
  assert.equal(out[2].objects[0].layerId, 'L2');
  assert.equal(next[1].objects[1].layerId, undefined, 'input not mutated');
  assert.equal(stampNewMarksByPage(prev, next, null), next, 'flag off / no active layer: unchanged');
  assert.equal(stampNewMarksByPage(prev, next, 'default'), next);
  assert.equal(stampNewMarksByPage(next, next, 'L2'), next, 'nothing new: same reference');
});

test('text-markup transactions: undo step rebuilt from stamped pages keeps the layer on redo', async () => {
  const { buildTextMarkupDocumentAction } = await import('../src/utils/textMarkupGroupTransactions.js');
  const { applyAnnotationHistoryAction } = await import('../src/utils/annotationLocalHistory.js');
  const prev = { 1: { objects: [{ type: 'rect', data: { id: 'old' } }] } };
  const next = {
    1: { objects: [{ type: 'rect', data: { id: 'old' } }, { type: 'group', data: { id: 'hl1', textMarkupType: 'highlight' } }] },
    2: { objects: [{ type: 'group', data: { id: 'st1', textMarkupType: 'strikeout' } }] },
  };
  const stamped = stampNewMarksByPage(prev, next, 'L2');
  const action = buildTextMarkupDocumentAction(prev, stamped);
  const redone = applyAnnotationHistoryAction(prev, action);
  const find = (byPage, page, id) => (byPage[page] || byPage[String(page)]).objects.find((o) => o.data?.id === id);
  assert.equal(find(redone, 1, 'hl1').layerId, 'L2');
  assert.equal(find(redone, 2, 'st1').layerId, 'L2');
  assert.equal(find(redone, 1, 'old').layerId, undefined);
});

test('text-markup transactions: a mark moved to another page keeps its (default) layer', async () => {
  const { readFileSync } = await import('node:fs');
  const moved = { data: { id: 'm1' } };
  const prev = { 1: { objects: [moved] }, 2: { objects: [] } };
  const next = { 1: { objects: [] }, 2: { objects: [moved] } };
  assert.equal(stampNewMarksByPage(prev, next, 'L2'), next);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /saveContext\?\.action !== 'move-to-page' && saveContext\?\.action !== 'move-region'/);
});
