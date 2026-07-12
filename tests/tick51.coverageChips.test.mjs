/**
 * Tick-51 coverage chips: ink color fallbacks, AutoCAD SHX, Line rect-fallback,
 * FreeTextCallout near-white border, RDP t>1, short-poly merge guards,
 * undo getYEventPath function/throw via synthetic stack-item-added.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
  categorizeAnnotations,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  simplifyPolygon,
  mergeRegions,
  mergeOverlappingRegions,
  subtractRegionFromRegion,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';
import { createUndoManager } from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';

function makeViewport(h = 400) {
  return {
    width: 300,
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

test('importer ink color fallbacks + AutoCAD SHX + Line rect path', () => {
  const viewport = makeViewport();

  // pdfColorToHex: falsy color → annotation.color / borderColor / default black
  const inkBorder = convertInkToFabricPath({
    subtype: 'Ink',
    color: null,
    borderColor: [1, 0, 0],
    borderStyle: { width: 2 },
    inkLists: [[[0, 0], [10, 0], [10, 10]]],
  }, viewport);
  assert.ok(inkBorder);

  const inkBlack = convertInkToFabricPath({
    subtype: 'Ink',
    color: undefined,
    borderStyle: { width: 1 },
    inkLists: [[[0, 0], [5, 5]]],
  }, viewport);
  assert.ok(inkBlack);

  // Non-object / non-array-like color → else black
  const inkNum = convertInkToFabricPath({
    subtype: 'Ink',
    color: 42,
    borderStyle: { width: 1 },
    inkLists: [[[0, 0], [3, 3]]],
  }, viewport);
  assert.ok(inkNum);

  // Empty array color
  const inkEmpty = convertInkToFabricPath({
    subtype: 'Ink',
    color: [],
    borderStyle: { width: 1 },
    inkLists: [[[0, 0], [4, 0]]],
  }, viewport);
  assert.ok(inkEmpty);

  // Object color without rgb keys → black
  const inkBadObj = convertInkToFabricPath({
    subtype: 'Ink',
    color: { foo: 1 },
    borderStyle: { width: 1 },
    inkLists: [[[0, 0], [2, 2]]],
  }, viewport);
  assert.ok(inkBadObj);

  // AutoCAD SHX Square proxy
  const shx = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [10, 10, 80, 40],
    title: 'AutoCAD SHX Text',
    contents: 'WALL-A',
    color: [0, 0, 0],
    borderStyle: { width: 0 },
  }, viewport);
  assert.equal(shx?.pdfAnnotationType, 'AutoCAD SHX Text');
  assert.equal(shx?.data?.shxText, 'WALL-A');

  // titleObj / contentsObj paths via Text note
  const note = convertPdfAnnotationToFabric({
    subtype: 'Text',
    rect: [0, 0, 20, 20],
    titleObj: { str: '  note-title  ' },
    contentsObj: { str: '  body  ' },
    color: [1, 0.9, 0.2],
  }, viewport);
  assert.ok(note);

  // Line without lineCoordinates → rect fallback; start-only arrow swaps ends
  const lineRect = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 40, 30],
    lineEndings: ['OpenArrow', 'None'],
    color: [0, 0, 0],
    borderStyle: { width: 2 },
  }, viewport);
  assert.ok(lineRect?.type === 'line' || lineRect?.tool === 'arrow');

  // Line import diag gate
  const prevWin = globalThis.window;
  globalThis.window = { __LINE_IMPORT_DIAG: true };
  try {
    const diagLine = convertPdfAnnotationToFabric({
      subtype: 'Line',
      rect: [0, 0, 20, 20],
      lineCoordinates: [0, 0, 20, 20],
      lineEndings: ['ClosedArrow', 'None'],
      color: [0, 0, 1],
      borderStyle: { width: 1 },
    }, viewport);
    assert.ok(diagLine);
  } finally {
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
  }

  // FreeTextCallout near-white /C with non-white AP stroke
  const callout = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    intent: 'FreeTextCallout',
    rect: [50, 50, 150, 100],
    contents: 'Callout near white border',
    color: [0.98, 0.98, 0.98],
    calloutLine: [50, 50, 80, 80, 120, 70],
    borderStyle: { width: 1 },
    defaultAppearanceString: '0 0 1 rg /Helv 12 Tf',
    defaultStyleString: 'font: Helvetica 12pt; color: #0000ff',
    _appearance: {
      strokeColor: [0, 0, 0.8],
      matrix: [1, 0, 0, 1, 0, 0],
      bbox: [0, 0, 100, 50],
      path: [
        ['M', 0, 0],
        ['L', 100, 0],
        ['L', 100, 50],
        ['L', 0, 50],
        ['Z'],
      ],
    },
  }, viewport);
  assert.ok(callout);

  // Near-white border, no useful AP → fall through to textColor
  const callout2 = convertPdfAnnotationToFabric({
    subtype: 'FreeText',
    intent: 'FreeTextCallout',
    rect: [10, 10, 90, 50],
    contents: 'x',
    color: [1, 1, 1],
    calloutLine: [10, 10, 40, 40],
    borderStyle: { width: 1 },
    defaultAppearanceString: '1 0 0 rg /Helv 10 Tf',
  }, viewport);
  assert.ok(callout2);

  // rawMetadata borderStyleType injection
  const dashedRaw = convertPdfAnnotationToFabric({
    subtype: 'Line',
    rect: [0, 0, 30, 10],
    lineCoordinates: [0, 0, 30, 10],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, viewport, 1, {
    borderStyleType: 'D',
    borderDashArray: [4, 2],
    borderWidth: 3,
  });
  assert.ok(dashedRaw);

  const cats = categorizeAnnotations([
    { subtype: 'Ink' },
    { subtype: 'Link' },
    { subtype: 'UnknownWidgetX' },
    { subtype: 'Popup' },
  ]);
  assert.ok(cats.supported.length >= 1);
});

test('regionMath RDP t>1 + short-poly overlap + null slots', () => {
  // Intermediate point past segment end → getSqSegDist t>1
  const open = [0, 0, 40, 0, 10, 0, 10, 8, 0, 8];
  const simp = simplifyPolygon(open, 0.5);
  assert.ok(Array.isArray(simp));
  assert.ok(simp.length >= 4);

  // Another: projection beyond p2 along a diagonal segment
  const diag = [0, 0, 100, 50, 20, 10, 20, 40, 0, 40];
  assert.ok(Array.isArray(simplifyPolygon(diag, 1)));

  // Overlapping bounds but too-few points → regionToPolygon null (merge/overlap guards)
  const shortA = {
    regionId: 'sa',
    pageId: 'p1',
    shapeType: 'polygon',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 20, 20],
  };
  const shortB = {
    regionId: 'sb',
    pageId: 'p1',
    shapeType: 'polygon',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [5, 5, 25, 25],
  };
  assert.equal(mergeRegions(shortA, shortB), null);
  assert.deepEqual(subtractRegionFromRegion(shortA, shortB), [shortA]);

  const good = {
    regionId: 'g',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  const far = {
    regionId: 'g2',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [100, 100, 110, 100, 110, 110, 100, 110],
  };
  const merged = mergeOverlappingRegions([good, far]);
  assert.ok(Array.isArray(merged));
  assert.equal(merged.length, 2);
});

test('undo synthetic stack-item-added covers getYEventPath function/throw', () => {
  const ydoc = new Y.Doc();
  const ctx = { userId: 'u51', deviceId: 'd1', sessionId: 's51', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    captureTimeout: 0,
    historyCap: 5,
  });
  const yMap = ydoc.getMap('annotations');
  const yCallouts = ydoc.getMap('callouts');

  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 1, top: 1, width: 4, height: 4, data: { id: 'r51' }, pageNumber: 2 },
    origin,
    ctx,
  );

  // lib0 Observable.emit(name, argsArray)
  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: yMap,
          path: () => ['annotations', 'r51'],
          changes: {
            keys: {
              forEach(fn) { fn({ action: 'update' }, 'r51'); },
              get: () => ({ oldValue: null }),
            },
          },
        }]);
      },
    },
  }]);

  undoManager.emit('stack-item-added', [{
    type: 'redo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: yCallouts,
          path: () => { throw new Error('path-boom'); },
          changes: {
            keys: {
              forEach(fn) { fn({ action: 'add' }, 'c51'); },
              get: () => null,
            },
          },
        }]);
      },
    },
  }]);

  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: { meta: { set() {} } },
    changedParentTypes: {
      forEach(cb) {
        cb([{
          target: yMap,
          path: ['annotations', 'r51'],
          changes: {
            keys: {
              forEach() { throw new Error('keys-boom'); },
              get() { throw new Error('get-boom'); },
            },
          },
        }, {
          target: {
            parent: {
              get(key) {
                if (key === 'pageNumber') throw new Error('page-boom');
                return null;
              },
            },
          },
          path: ['annotations', 'r51'],
          changes: { keys: { forEach() {}, get: () => null } },
        }]);
      },
    },
  }]);

  undoManager.emit('stack-item-added', [{
    type: 'undo',
    stackItem: {
      meta: {
        set() { throw new Error('meta-boom'); },
      },
    },
    changedParentTypes: { forEach() {} },
  }]);

  dispose();
  ydoc.destroy();
  assert.ok(true);
});
