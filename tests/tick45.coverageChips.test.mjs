/**
 * Tick-45 coverage chips: appearance-path import, fabric-row dedupe,
 * pageSpace eraser H/V paths, paper erase empty-subject, region touch-merge,
 * undo object-vs-array shallowEqual.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  convertPdfAnnotationToFabric,
  convertInkToFabricPath,
} from '../src/utils/pdfAnnotationImporter.js';
import {
  normalizeFabricAnnotationRows,
  serializeFabricObjectToRow,
  deserializeRowToFabricObject,
  serializeCalloutToRow,
  deserializeRowToCallout,
} from '../src/services/annotationTypeSerializers.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  createInkAnnotation,
  eraseAnnotations,
  translatePolygonSet,
} from '../src/utils/paperAnnotationGeometry.js';
import {
  mergeRegions,
  REGION_OPERATIONS,
} from '../src/utils/regionMath.js';
import {
  createUndoManager,
  userUndo,
} from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';
import {
  resetMigrationFlag,
  hasMigrationRun,
} from '../src/services/cloudSyncMigration.js';

function makeViewport(h = 200) {
  return {
    height: h,
    convertToViewportPoint: (x, y) => [x, h - y],
    convertToViewportRectangle: (r) => [r[0], h - r[3], r[2], h - r[1]],
  };
}

test('importer appearance C/Z path + dashed square + ink fallback', () => {
  const viewport = makeViewport();

  const appearanceInk = convertInkToFabricPath({
    subtype: 'Ink',
    color: [0, 0, 0],
    borderStyle: { width: 0 },
    _appearance: {
      hasFill: true,
      path: [
        ['M', 0, 0],
        ['C', 5, 10, 15, 10, 20, 0],
        ['L', 20, 20],
        ['Z'],
        null,
        ['X', 1],
      ],
    },
  }, viewport);
  assert.ok(appearanceInk?.path?.length);

  const noList = convertInkToFabricPath({
    subtype: 'Ink',
    color: [1, 0, 0],
    borderStyle: { width: 1 },
    inkLists: [],
    _appearance: {
      hasFill: false,
      path: [['M', 1, 1], ['L', 5, 5]],
    },
  }, viewport);
  assert.ok(noList?.path?.length);

  const dashed = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [0, 0, 40, 30],
    color: [0, 0, 0],
    borderStyle: { width: 2, style: 'D', dashArray: [3, 2] },
  }, viewport);
  assert.ok(dashed);

  const cloudy = convertPdfAnnotationToFabric({
    subtype: 'Polygon',
    rect: [0, 0, 50, 50],
    vertices: [0, 0, 50, 0, 25, 40],
    color: [0.2, 0.2, 0.2],
    borderEffect: { style: 'C', intensity: 2 },
    borderStyle: { width: 1 },
  }, viewport);
  assert.ok(cloudy);

  // Viewport without convert helpers → manual flip branches
  const bareVp = { height: 100 };
  const bare = convertPdfAnnotationToFabric({
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    color: [0, 0, 0],
    borderStyle: { width: 1 },
  }, bareVp);
  assert.ok(bare);
});

test('annotationTypeSerializers dedupe + throw guards', () => {
  const rows = normalizeFabricAnnotationRows([
    {
      annotation_id: 'a1',
      annotation_type: 'ink',
      page_number: 1,
      updated_at: '2020-01-01T00:00:00Z',
      annotation_data: {
        pageNumber: 1,
        fabricObject: {
          type: 'path',
          isPdfImported: true,
          pdfAnnotationId: 'pdf-1',
          path: [['M', 0, 0], ['L', 1, 0]],
          data: { id: 'a1' },
        },
      },
    },
    {
      annotation_id: 'a2',
      annotation_type: 'highlight',
      page_number: 1,
      updated_at: '2021-01-01T00:00:00Z',
      annotation_data: {
        pageNumber: 1,
        fabricObject: {
          type: 'rect',
          isPdfImported: true,
          pdfAnnotationId: 'pdf-1',
          data: { id: 'a2' },
        },
      },
    },
    {
      annotation_id: 'a3',
      annotation_type: 'ink',
      page_number: 1,
      updated_at: '2022-01-01T00:00:00Z',
      annotation_data: {
        pageNumber: 1,
        fabricObject: {
          type: 'path',
          isPdfImported: true,
          pdfAnnotationId: 'pdf-1',
          path: [['M', 0, 0], ['L', 2, 0]],
          data: { id: 'a3' },
        },
      },
    },
    null,
  ]);
  assert.ok(Array.isArray(rows));
  assert.equal(normalizeFabricAnnotationRows(null).length, 0);

  assert.throws(() => serializeFabricObjectToRow(null));
  assert.throws(() => deserializeRowToFabricObject({ annotation_type: 'highlight' }));
  assert.throws(() => serializeCalloutToRow(null));
  assert.throws(() => deserializeRowToCallout({ annotation_type: 'ink' }));
});

test('pageSpaceEraser relative H/V/C path + paper empty subject', () => {
  const objects = [
    {
      type: 'path',
      left: 0,
      top: 0,
      strokeWidth: 3,
      path: [['m', 0, 0], ['h', 40], ['v', 10], ['c', 5, 5, 10, 5, 15, 0], ['z']],
      data: { id: 'rel-path' },
    },
    {
      type: 'path',
      left: 0,
      top: 0,
      strokeWidth: 8,
      fill: '#333',
      path: [['M', 100, 100], ['L', 140, 100], ['L', 140, 140], ['Z']],
      data: { id: 'filled' },
    },
  ];
  const result = erasePageAnnotations({
    objects,
    eraserPoints: [{ x: 20, y: 0 }, { x: 25, y: 5 }],
    radius: 6,
    mode: 'partial',
  });
  assert.ok(result);

  const emptySubject = eraseAnnotations(
    [{ id: 'empty', cmds: [], strokeWidth: 10, forcePolygon: true }],
    [{ x: 0, y: 0 }],
    5,
    'partial',
  );
  assert.equal(emptySubject.changedIds.length, 0);

  const filled = createInkAnnotation([{ x: 0, y: 0 }, { x: 40, y: 0 }], { id: 'far', width: 12 });
  const miss = eraseAnnotations([filled], [{ x: 500, y: 500 }], 2, 'partial');
  assert.equal(miss.changedIds.length, 0);

  assert.ok(translatePolygonSet([[[0, 0], [1, 0], [1, 1], [0, 0]]], 2, 3));
});

test('regionMath point-touch merge returns null + undo array-vs-object', () => {
  const a = {
    regionId: 'a',
    pageId: 'p1',
    shapeType: 'rectangular',
    operation: REGION_OPERATIONS.ADD,
    coordinates: [0, 0, 10, 0, 10, 10, 0, 10],
  };
  const touch = {
    ...a,
    regionId: 't',
    coordinates: [10, 10, 20, 10, 20, 20, 10, 20],
  };
  // Corner-touching regions: union often yields multi-poly → merge null
  const merged = mergeRegions(a, touch);
  assert.ok(merged === null || merged?.coordinates);

  const ydoc = new Y.Doc();
  const ctx = { userId: 'u45', deviceId: 'd1', sessionId: 's45', clientID: ydoc.clientID };
  const { undoManager, origin, dispose } = createUndoManager({ ydoc, ...ctx, captureTimeout: 0 });
  const yMap = ydoc.getMap('annotations');
  applyFabricCommit(
    ydoc,
    yMap,
    { type: 'rect', left: 0, top: 0, width: 4, height: 4, data: { id: 'ov' }, pageNumber: 1 },
    origin,
    ctx,
  );
  ydoc.transact(() => {
    const fabric = yMap.get('ov')?.get?.('fabric');
    fabric?.set?.('custom', { a: 1 });
  });
  ydoc.getMap('__annotationLatestFabric').set('ov', {
    type: 'rect',
    left: 0,
    top: 0,
    width: 4,
    height: 4,
    custom: [1, 2], // array vs object → shallowEqual Array.isArray(b) branch
  });
  userUndo(ydoc, undoManager, ctx);
  dispose();
  ydoc.destroy();
});

test('cloudSyncMigration resetMigrationFlag localStorage throw', () => {
  globalThis.localStorage = {
    removeItem() { throw new Error('denied'); },
    getItem() { return null; },
  };
  try {
    resetMigrationFlag('u', 'd');
    assert.equal(hasMigrationRun('u', 'd'), false);
  } finally {
    delete globalThis.localStorage;
  }
});
