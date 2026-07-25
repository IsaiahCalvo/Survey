import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as Y from 'yjs';

import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';
import {
  createUndoManager,
  userRedo,
  userUndo,
} from '../src/lib/collab/crdtUndoManager.js';

const PAGE_ANNOTATION_LAYER_SOURCE = new URL(
  '../src/PageAnnotationLayer.jsx',
  import.meta.url,
);
const ANNOTATION_DOC_SYNC_SOURCE = new URL(
  '../src/services/annotationDocSync.js',
  import.meta.url,
);

function makeFabricObject(values) {
  const object = {
    type: 'path',
    left: 0,
    top: 0,
    ...values,
  };

  object.toObject = (propertiesToInclude = []) => {
    const serialized = {
      type: object.type,
      left: object.left,
      top: object.top,
    };
    if (object.fill !== undefined) {
      serialized.fill = object.fill;
    }
    for (const property of propertiesToInclude) {
      if (object[property] !== undefined) {
        serialized[property] = object[property];
      }
    }
    return serialized;
  };

  return object;
}

test('actual applyFabricCommit property edit Undo and Redo restore the exact prior and edited geometry', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctx = {
    userId: 'geometry-history-user',
    deviceId: 'geometry-history-device',
    sessionId: 'geometry-history-session',
    clientID: ydoc.clientID,
  };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    captureTimeout: 0,
  });
  const observedHistoryOrigins = [];
  ydoc.on('afterTransaction', (transaction) => {
    if (transaction.origin === undoManager) {
      observedHistoryOrigins.push(transaction.origin.source);
    }
  });

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      makeFabricObject({
        data: { id: 'geometry-history-ink' },
        left: 12,
        fill: '#112233',
        polygons: [[[[0, 0], [20, 0], [20, 10], [0, 0]]]],
      }),
      origin,
      ctx,
    );
    undoManager.stopCapturing();

    applyFabricCommit(
      ydoc,
      annotations,
      makeFabricObject({
        data: { id: 'geometry-history-ink' },
        left: 38,
        fill: '#abcdef',
        polygons: [[[[0, 0], [13, 0], [13, 10], [0, 0]]]],
      }),
      origin,
      ctx,
    );
    undoManager.stopCapturing();

    userUndo(ydoc, undoManager, ctx);
    const afterUndo = annotations.get('geometry-history-ink').get('fabric');
    assert.equal(afterUndo.get('left'), 12);
    assert.equal(afterUndo.get('fill'), '#112233');
    assert.deepEqual(
      afterUndo.get('polygons'),
      [[[[0, 0], [20, 0], [20, 10], [0, 0]]]],
    );

    userRedo(ydoc, undoManager, ctx);
    const afterRedo = annotations.get('geometry-history-ink').get('fabric');
    assert.equal(afterRedo.get('left'), 38);
    assert.equal(afterRedo.get('fill'), '#abcdef');
    assert.deepEqual(
      afterRedo.get('polygons'),
      [[[[0, 0], [13, 0], [13, 10], [0, 0]]]],
    );
    assert.deepEqual(
      observedHistoryOrigins,
      ['local-undo', 'local-redo'],
      'history transactions retain local attribution without an outer Yjs transaction',
    );
  } finally {
    dispose();
    ydoc.destroy();
  }
});

test('CRDT Fabric serialization preserves every canonical ink geometry field', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctx = {
    userId: 'geometry-serialization-user',
    deviceId: 'geometry-serialization-device',
    sessionId: 'geometry-serialization-session',
    clientID: ydoc.clientID,
  };
  const { origin, dispose } = createUndoManager({ ydoc, ...ctx });
  const expected = {
    polygons: [[[[1, 2], [11, 2], [11, 9], [1, 2]]]],
    paperInkGeometry: 'v1',
    paperEraserGeometry: 'v1',
    paperEraserBaseTransform: {
      left: 10,
      top: 20,
      scaleX: 2,
      scaleY: 3,
      angle: 15,
    },
    cmds: [['M', 1, 5], ['L', 11, 5]],
    paperCenterline: [{ x: 1, y: 5 }, { x: 11, y: 5 }],
    paperCenterlineRuns: [[{ x: 1, y: 5 }, { x: 11, y: 5 }]],
    sourceWidth: 7,
    inkGeometrySpace: 'local',
    inkGeometryOrigin: 'center-v1',
    fillRule: 'evenodd',
    flipX: true,
    flipY: false,
    skewX: 9,
    skewY: -4,
    originX: 'left',
    originY: 'top',
  };

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      makeFabricObject({
        data: { id: 'geometry-serialization-ink' },
        ...expected,
      }),
      origin,
      ctx,
    );

    const saved = annotations
      .get('geometry-serialization-ink')
      .get('fabric')
      .toJSON();
    for (const [property, value] of Object.entries(expected)) {
      assert.deepEqual(saved[property], value, `${property} must survive CRDT serialization`);
    }
  } finally {
    dispose();
    ydoc.destroy();
  }
});

test('erased-lane collaboration rebases every persisted Fabric affine field', () => {
  const source = readFileSync(ANNOTATION_DOC_SYNC_SOURCE, 'utf8');
  const transformCopy = source.match(
    /for \(const key of \[\s*([\s\S]*?)\s*\]\) \{\s*if \(Object\.prototype\.hasOwnProperty\.call\(desiredBaseTransform, key\)\)/,
  )?.[1] || '';

  for (const property of [
    'left',
    'top',
    'scaleX',
    'scaleY',
    'angle',
    'skewX',
    'skewY',
    'flipX',
    'flipY',
    'originX',
    'originY',
    'pathOffset',
  ]) {
    assert.match(
      transformCopy,
      new RegExp(`['"]${property}['"]`),
      `${property} must rebase from a materialized eraser survivor to its stable base`,
    );
  }
});

test('every legacy PageAnnotationLayer canvas save includes canonical ink geometry', () => {
  const source = readFileSync(PAGE_ANNOTATION_LAYER_SOURCE, 'utf8');
  const saveWhitelists = [
    ...source.matchAll(/\.toObject\(\[([^\]]*)\]\)/g),
  ].map((match) => match[1]);
  const requiredProperties = [
    'polygons',
    'paperInkGeometry',
    'paperEraserGeometry',
    'paperEraserBaseTransform',
    'cmds',
    'paperCenterline',
    'paperCenterlineRuns',
    'sourceWidth',
    'inkGeometrySpace',
    'inkGeometryOrigin',
    'fillRule',
  ];

  assert.equal(saveWhitelists.length, 5, 'all five legacy Fabric save paths stay covered');
  saveWhitelists.forEach((whitelist, index) => {
    for (const property of requiredProperties) {
      assert.match(
        whitelist,
        new RegExp(`['"]${property}['"]`),
        `legacy save whitelist ${index + 1} must include ${property}`,
      );
    }
  });
});
