/**
 * Tick-50 coverage chips: no-locks backfill fallback, dash [3,3] via Line/PolyLine,
 * pdfColorToHex edge inputs, toNumericArray object/view, regionMath RDP t>1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
} from '../src/utils/pdfAnnotationImporter.js';
import { runBackfill } from '../src/lib/collab/crdtBackfill.js';
import { __resetDocumentMetadataCacheForTests } from '../src/services/documentMetadataResolver.js';
import {
  simplifyPolygon,
  mergeRegions,
  subtractRegionFromRegion,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';
import {
  createUndoManager,
  userUndo,
  userRedo,
} from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit, applyCalloutCommit } from '../src/lib/collab/crdtAnnotationBridge.js';

function makeViewport(h = 400) {
  return {
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

function withNavigator(value, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value,
  });
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
      else delete globalThis.navigator;
    });
}

test('backfill no-locks fallback when navigator.locks missing', async () => {
  __resetDocumentMetadataCacheForTests();
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  try {
    await withNavigator({}, async () => {
      const result = await runBackfill({
        ydoc,
        documentId: 'doc-nolock',
        userId: 'user-nolock',
        yMapAnnotations: yMap,
        supabase: {
          from() {
            const b = {};
            const self = () => b;
            for (const m of ['select', 'eq', 'in', 'order', 'range']) b[m] = self;
            b.then = (resolve) => resolve({ data: [], error: null });
            return b;
          },
        },
        existingHydrateRows: [{
          annotation_id: 'nl1',
          annotation_type: 'ink',
          page_number: 1,
          user_id: 'author',
          created_at: '2020-01-01T00:00:00Z',
          annotation_data: {
            fabricObject: {
              type: 'path',
              path: [['M', 0, 0], ['L', 5, 0]],
              data: { id: 'nl1' },
            },
            pageNumber: 1,
          },
        }],
      });
      assert.ok(result?.ranAs);
    });
  } finally {
    ydoc.destroy();
    __resetDocumentMetadataCacheForTests();
  }
});

test('backfill uses navigator.locks exclusive path', async () => {
  __resetDocumentMetadataCacheForTests();
  const ydoc = new Y.Doc();
  const yMap = ydoc.getMap('annotations');
  let lockNameSeen = null;
  try {
    await withNavigator({
      locks: {
        request(name, opts, fn) {
          lockNameSeen = name;
          assert.equal(opts?.mode, 'exclusive');
          return fn();
        },
      },
    }, async () => {
      const result = await runBackfill({
        ydoc,
        documentId: 'doc-locks',
        userId: 'user-locks',
        yMapAnnotations: yMap,
        supabase: {
          from() {
            const b = {};
            const self = () => b;
            for (const m of ['select', 'eq', 'in', 'order', 'range']) b[m] = self;
            b.then = (resolve) => resolve({ data: [], error: null });
            return b;
          },
        },
        existingHydrateRows: [{
          annotation_id: 'lk1',
          annotation_type: 'ink',
          page_number: 1,
          user_id: 'author',
          created_at: '2020-01-01T00:00:00Z',
          annotation_data: {
            fabricObject: {
              type: 'path',
              path: [['M', 0, 0], ['L', 5, 0]],
              data: { id: 'lk1' },
            },
            pageNumber: 1,
          },
        }],
      });
      assert.equal(lockNameSeen, 'y-doc-backfill-user-locks-doc-locks');
      assert.ok(result?.ranAs);
    });
  } finally {
    ydoc.destroy();
    __resetDocumentMetadataCacheForTests();
  }
});

test('importer dash fallback via Line/PolyLine + color/dash helpers', () => {
  const viewport = makeViewport();

  // Line: /S=D with empty dash → fallback [3,3]
  const dashedLine = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 40, 10],
    lineCoordinates: [0, 0, 40, 10],
    color: [0, 0, 0],
    borderStyle: { width: 2, style: 'D', dashArray: [] },
    borderStyleType: 'D',
  }, viewport);
  assert.ok(dashedLine?.strokeDashArray?.length >= 2);

  // PolyLine: /S=D with zero-only dash (filtered) → fallback
  const dashedPoly = convertPdfAnnotationToFabric({
    subtype: 'PolyLine',
    rect: [0, 0, 50, 50],
    vertices: [0, 0, 25, 40, 50, 0],
    color: [0, 0, 0],
    borderStyle: { width: 1, style: 'D', dashArray: [0, 0] },
  }, viewport);
  assert.ok(dashedPoly?.strokeDashArray?.length >= 2);

  // Polygon: dash as object numeric keys (toNumericArray object path)
  const objDash = convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 40, 40],
    vertices: [0, 0, 40, 0, 20, 30],
    color: [0, 0, 0],
    borderStyle: { width: 1, style: 'D', dashArray: { 0: 5, 1: 3 } },
  }, viewport);
  assert.ok(objDash?.strokeDashArray);

  // dash as Uint8Array (ArrayBuffer.isView)
  const viewDash = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 20, 20],
    lineCoordinates: [0, 0, 20, 20],
    color: [0, 0, 0],
    borderStyle: { width: 1, style: 'D', dashArray: new Uint8Array([6, 2]) },
  }, viewport);
  assert.ok(viewDash?.strokeDashArray);

  // /S=D with non-numeric object → still falls back to [3,3]
  const badObj = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 10, 10],
    lineCoordinates: [0, 0, 10, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1, style: 'D', dashArray: { foo: 'bar' } },
  }, viewport);
  assert.ok(badObj?.strokeDashArray?.length >= 2);

  // pdfColorToHex: object rgb keys + borderColor fallback + grayscale 0-255
  const rgbObj = convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [0, 0, 30, 30],
    color: { r: 10, g: 20, b: 30 },
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(rgbObj);

  const borderFallback = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 20, 20],
    borderColor: { 0: 200, 1: 100, 2: 50 },
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(borderFallback);

  const gray255 = convertPdfAnnotationToFabric({
    subtype: 'Circle',
    rect: [0, 0, 20, 20],
    color: [180],
    fillColor: [0, 255, 0],
    alpha: 0.5,
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(gray255);

  const bgFill = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 20, 20],
    color: [0, 0, 0],
    backgroundColor: [255, 0, 0],
    fillAlpha: 0.4,
    borderStyle: { width: 0 },
  }, viewport);
  assert.ok(bgFill === null || bgFill);

  // String color → default black branch
  const strColor = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 15, 15],
    color: 'not-a-color',
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(strColor);

  const cloudySq = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 60, 40],
    color: [0.1, 0.1, 0.1],
    borderStyle: { width: 1 },
    borderEffect: { style: 'C', intensity: 2 },
  }, viewport);
  assert.ok(cloudySq);

  const cloudyPoly = convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 50, 50],
    vertices: [0, 0, 50, 0, 25, 40],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
    borderEffect: { style: 'C', intensity: 1 },
  }, viewport);
  assert.ok(cloudyPoly);

  const arrow = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 40, 40],
    lineCoordinates: [0, 0, 40, 40],
    lineEndings: ['ROpenArrow', 'RClosedArrow'],
    color: [0, 0, 0],
    borderStyle: { width: 2 },
  }, viewport);
  assert.ok(arrow);

  const ink = convertInkToFabricPath({
    subtype: 'Ink',
    color: [0, 0, 1],
    strokeAlpha: 0.5,
    borderStyle: { width: 3 },
    inkLists: [[[0, 0], [8, 0], [8, 8]]],
  }, viewport);
  assert.ok(ink);

  const ft = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    rect: [0, 0, 80, 30],
    contents: 'z',
    color: [0, 0, 0],
    borderWidth: 0,
    borderStyle: { width: 0 },
    defaultAppearanceString: '0 0 0 rg /Helv 12 Tf',
    CA: 0.9,
  }, viewport);
  assert.ok(ft);
});

test('regionMath RDP t>1 + non-numeric coord merge + subtract miss', () => {
  // Far point past segment end forces getSqSegDist t>1
  const coords = [0, 0, 10, 0, 50, 0.01, 10, 10, 0, 10, 0, 0];
  const simp = simplifyPolygon(coords, 0.0001);
  assert.ok(Array.isArray(simp));

  // Colinear with outlier past end
  const simp2 = simplifyPolygon([0, 0, 5, 0, 100, 0, 5, 5, 0, 5, 0, 0], 1);
  assert.ok(Array.isArray(simp2));

  const nanRegion = {
    regionId: 'nan',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN],
  };
  const good = {
    regionId: 'g',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  assert.equal(mergeRegions(nanRegion, good), null);

  const nonNum = {
    regionId: 'nn',
    pageId: 'p1',
    shapeType: 'polygon',
    operation: REGION_OPERATIONS.ADD,
    coordinates: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
  };
  assert.equal(mergeRegions(nonNum, good), null);

  const hole = {
    regionId: 'h',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.SUBTRACT,
    coordinates: [2, 2, 8, 2, 8, 8, 2, 8],
  };
  const sub = subtractRegionFromRegion(good, hole);
  assert.ok(Array.isArray(sub));
});

test('undo callout+fabric stack for diagnostics path coverage', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u50', deviceId: 'd1', sessionId: 's50', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    captureTimeout: 0,
    historyCap: 3,
  });
  const yMap = ydoc.getMap('annotations');
  const yCallouts = ydoc.getMap('callouts');

  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 0, top: 0, width: 5, height: 5, data: { id: 'r50' }, pageNumber: 1 },
    origin,
    ctx,
  );
  applyCalloutCommit(
    ydoc,
    yCallouts,
    {
      id: 'c50',
      pageNumber: 1,
      text: 'x',
      arrowTip: { x: 0.1, y: 0.1 },
      knee: { x: 0.2, y: 0.2 },
      textBoxPosition: { x: 0.3, y: 0.3, width: 0.1, height: 0.05 },
    },
    origin,
    ctx,
  );
  ydoc.getMap('__annotationLatestFabric').set('r50', {
    type: 'rect',
    left: 0,
    top: 0,
    width: 5,
    height: 5,
    meta: { a: 1 },
  });
  ydoc.transact(() => {
    yMap.get('r50')?.get?.('fabric')?.set?.('meta', { a: 2 });
  });

  userUndo(ydoc, undoManager, ctx);
  userRedo(ydoc, undoManager, ctx);
  dispose();
  ydoc.destroy();
});
