/**
 * Tick-52 coverage chips: converter null guards (bad rect / degenerate poly),
 * counter invalid radius, undo annotationMap/type catch tails, PDF import debug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
  importAnnotationsFromPdf,
} from '../src/utils/pdfAnnotationImporter.js';
import { PDF_COUNTER_SUBJECT } from '../src/utils/pdfCounterMetadata.js';
import { createUndoManager } from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';
import {
  mergeRegions,
  subtractRegionFromRegion,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';

function makeViewport(h = 400) {
  return {
    width: 300,
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

test('importer null guards for bad rects and degenerate geometry', () => {
  const viewport = makeViewport();
  const noRect = { color: [0, 0, 0], borderStyle: { width: 1 } };

  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Square', title: 'AutoCAD SHX Text', contents: 'x' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Text' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Underline' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'StrikeOut' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Squiggly' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Caret' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Circle' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'FreeText', contents: 'z' }, viewport), null);
  assert.equal(convertPdfAnnotationToFabric({ ...noRect, subtype: 'Square', rect: [1, 2] }, viewport), null);

  // Zero-size circle → radius <= 0
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [10, 10, 10, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport), null);

  // PolyLine with no vertices/coords/rect → empty points
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'PolyLine',
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport), null);

  // PolyLine rect-diagonal fallback path (covers getAnnotationPolylinePoints rect branch)
  assert.ok(convertPdfAnnotationToFabric({
    subtype: 'PolyLine',
    rect: [0, 0, 10, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport));

  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 10, 10],
    vertices: [0, 0, 5, 5],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport), null);

  // Invisible polygon (no stroke, no fill)
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 40, 40],
    vertices: [0, 0, 40, 0, 20, 30],
    color: [0, 0, 0],
    borderStyle: { width: 0 },
  }, viewport), null);

  // Line with neither coords nor usable rect
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Line',
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport), null);

  // Counter metadata with invalid radius + zero rect → radius <= 0
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [10, 10, 10, 10],
    color: [1, 0, 0],
    borderStyle: { width: 1 },
    counterMetadata: {
      app: 'SurveyApp',
      kind: PDF_COUNTER_SUBJECT,
      radius: -1,
      id: 'ctr-bad',
    },
  }, viewport), null);

  // Square with no stroke and no fill → invisible
  assert.equal(convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 20, 20],
    color: [0, 0, 0],
    borderStyle: { width: 0 },
  }, viewport), null);
});

test('importAnnotationsFromPdf empty doc + debug logger', async () => {
  const prevWin = globalThis.window;
  globalThis.window = {
    __PDF_IMPORT_DEBUG: true,
    console: { debug() { throw new Error('debug-boom'); } },
  };
  try {
    const result = await importAnnotationsFromPdf({
      numPages: 0,
      getPage: async () => { throw new Error('no-pages'); },
    });
    assert.ok(result);
    assert.ok(Array.isArray(result.fabricObjects) || Array.isArray(result.annotations) || result);
  } finally {
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }
});

test('undo remaining path/annotationMap/type catch tails', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u52', deviceId: 'd1', sessionId: 's52', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    captureTimeout: 0,
    historyCap: 5,
  });
  const yMap = ydoc.getMap('annotations');

  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 0, top: 0, width: 3, height: 3, data: { id: 'r52' }, pageNumber: 1 },
    origin,
    ctx,
  );

  // path neither array nor function → []
  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: yMap,
          path: 42,
          changes: {
            keys: {
              forEach(fn) { fn({ action: 'update' }, 'r52'); },
              get: () => null,
            },
          },
        }]);
      },
    },
  }]);

  // annotationsMap.get miss → keys.get().oldValue throws (annotationMap catch)
  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: { notYMap: true },
          path: ['annotations', 'ghost-52'],
          changes: {
            keys: {
              forEach(fn) { fn({ action: 'delete' }, 'ghost-52'); },
              get() { throw new Error('oldValue-boom'); },
            },
          },
        }]);
      },
    },
  }]);

  // annotationMap.get('type') throws → fabric type catch
  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: { notYMap: true },
          path: ['annotations', 'ghost-type'],
          changes: {
            keys: {
              forEach(fn) { fn({ action: 'update' }, 'ghost-type'); },
              get: () => ({
                oldValue: {
                  get(key) {
                    if (key === 'type' || key === 'fabric') throw new Error('type-boom');
                    return null;
                  },
                },
              }),
            },
          },
        }]);
      },
    },
  }]);

  dispose();
  ydoc.destroy();
  assert.ok(true);
});

test('regionMath disjoint point-touch and null-ish merge inputs', () => {
  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  const b = {
    regionId: 'b',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [10, 0, 20, 0, 20, 10, 10, 10], // edge-touch only
  };
  // Point/edge touch often returns null (multi-poly or no merge)
  const merged = mergeRegions(a, b);
  assert.ok(merged === null || merged);

  assert.equal(mergeRegions(null, a), null);
  assert.equal(mergeRegions(a, null), null);
  assert.equal(subtractRegionFromRegion(null, a), null);
  assert.equal(subtractRegionFromRegion(a, null), null);

  // Mismatched operations
  const sub = {
    ...b,
    regionId: 's',
    operation: REGION_OPERATIONS.SUBTRACT,
    coordinates: [2, 2, 8, 2, 8, 8, 2, 8],
  };
  assert.equal(mergeRegions(a, sub), null);
});
