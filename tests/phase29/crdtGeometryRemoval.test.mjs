import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import {
  applyFabricCommit,
  applyYUpdateToFabric,
} from '../../src/lib/collab/crdtAnnotationBridge.js';
import {
  createUndoManager,
  userRedo,
  userUndo,
} from '../../src/lib/collab/crdtUndoManager.js';
import { createInkPathAffine } from '../../src/utils/inkGeometryTransform.js';

function origin(doc, userId) {
  return Object.freeze({
    source: 'local-fabric',
    userId,
    deviceId: `${userId}-device`,
    sessionId: `${userId}-session`,
    clientID: doc.clientID,
  });
}

function fabricObject(id, snapshot) {
  return {
    data: { id },
    pageNumber: 1,
    toObject: () => structuredClone(snapshot),
  };
}

const centerLocalInk = {
  type: 'path',
  data: {
    id: 'geometry-removal-ink',
    inkGeometrySpace: 'local',
    inkGeometryOrigin: 'center-v1',
  },
  path: [['M', 0, 50], ['C', 30, 20, 70, 80, 100, 50]],
  cmds: [['M', 0, 50], ['C', 30, 20, 70, 80, 100, 50]],
  polygons: [[[[0, 40], [100, 40], [100, 60], [0, 40]]]],
  paperCenterline: [[0, 50], [100, 50]],
  paperCenterlineRuns: [[[0, 50], [100, 50]]],
  sourceWidth: 12,
  paperInkGeometry: 'v1',
  paperEraserGeometry: 'v1',
  paperEraserBaseTransform: { left: 25, top: 30 },
  inkGeometrySpace: 'local',
  inkGeometryOrigin: 'center-v1',
  fillRule: 'evenodd',
  strokeDashArray: [10, 10],
  strokeDashOffset: 3,
  pathOffset: { x: 50, y: 50 },
  originX: 'center',
  originY: 'center',
  flipX: true,
  flipY: true,
  skewX: 13,
  skewY: -7,
  left: 25,
  top: 30,
  scaleX: 1,
  scaleY: 1,
  fill: null,
  stroke: '#d11',
  strokeWidth: 12,
};

const pageSpaceSurvivor = {
  type: 'path',
  data: {
    id: 'geometry-removal-ink',
    inkGeometrySpace: 'page',
  },
  path: [['M', 25, 80], ['C', 40, 65, 72, 92, 125, 80]],
  inkGeometrySpace: 'page',
  left: 0,
  top: 0,
  width: 100,
  height: 27,
  scaleX: 1,
  scaleY: 1,
  angle: 0,
  fill: null,
  stroke: '#d11',
  strokeWidth: 12,
};

const clippedCurveSurvivor = {
  ...pageSpaceSurvivor,
  paperSourceStroke: {
    path: structuredClone(centerLocalInk.path),
    matrix: [1, 0, 0, 1, 25, 30],
    stroke: '#d11',
    strokeWidth: 12,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  },
  paperEraserCuts: [[[
    [70, 70],
    [82, 70],
    [82, 82],
    [70, 82],
    [70, 70],
  ]]],
};

test('exact source curve and cut mask survive CRDT materialization unchanged', async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      fabricObject('geometry-removal-ink', clippedCurveSurvivor),
      origin(docA, 'eraser-a'),
      { userId: 'eraser-a', deviceId: 'eraser-a-device' },
    );
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const materialized = JSON.parse(JSON.stringify(
      annotationsB.get('geometry-removal-ink').get('fabric').toJSON(),
    ));
    assert.deepEqual(
      materialized.paperSourceStroke,
      clippedCurveSurvivor.paperSourceStroke,
    );
    assert.deepEqual(
      materialized.paperEraserCuts,
      clippedCurveSurvivor.paperEraserCuts,
    );

    const mounted = {
      set(values) {
        Object.assign(this, values);
      },
      setCoords() {},
    };
    applyYUpdateToFabric(
      annotationsB,
      'geometry-removal-ink',
      new Map([['geometry-removal-ink', mounted]]),
    );
    assert.deepEqual(mounted.paperSourceStroke, clippedCurveSurvivor.paperSourceStroke);
    assert.deepEqual(mounted.paperEraserCuts, clippedCurveSurvivor.paperEraserCuts);
    await Promise.resolve();
  } finally {
    docA.destroy();
    docB.destroy();
  }
});

test('partial-erase bake deletes stale center-local geometry keys and clears a mounted remote object', async () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const originA = origin(docA, 'eraser-a');
  const ctxA = { userId: 'eraser-a', deviceId: 'eraser-a-device' };

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      fabricObject('geometry-removal-ink', centerLocalInk),
      originA,
      ctxA,
    );
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    applyFabricCommit(
      docA,
      annotationsA,
      fabricObject('geometry-removal-ink', pageSpaceSurvivor),
      originA,
      ctxA,
    );

    const localFabricMap = annotationsA.get('geometry-removal-ink').get('fabric');
    assert.equal(localFabricMap.get('inkGeometrySpace'), 'page');
    for (const key of [
      'pathOffset',
      'originX',
      'originY',
      'flipX',
      'flipY',
      'skewX',
      'skewY',
      'inkGeometryOrigin',
      'cmds',
      'polygons',
      'paperCenterline',
      'paperCenterlineRuns',
      'sourceWidth',
      'paperInkGeometry',
      'paperEraserGeometry',
      'paperEraserBaseTransform',
      'fillRule',
      'strokeDashArray',
      'strokeDashOffset',
    ]) {
      assert.equal(localFabricMap.get(key), undefined, `${key} must be absent after the bake`);
      assert.equal(localFabricMap.has(key), true, `${key} must retain an Undo-safe tombstone`);
    }

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const remoteFabricMap = annotationsB.get('geometry-removal-ink').get('fabric');
    assert.deepEqual(
      JSON.parse(JSON.stringify(remoteFabricMap.toJSON())),
      pageSpaceSurvivor,
      'undefined CRDT tombstones must disappear from the materialized JSON shape',
    );

    const mounted = {
      ...structuredClone(centerLocalInk),
      set(values) {
        Object.assign(this, values);
      },
      setCoords() {},
    };
    applyYUpdateToFabric(
      annotationsB,
      'geometry-removal-ink',
      new Map([['geometry-removal-ink', mounted]]),
    );

    assert.equal(mounted.inkGeometrySpace, 'page');
    assert.equal(mounted.inkGeometryOrigin, undefined);
    assert.equal(mounted.pathOffset, undefined);
    assert.equal(mounted.originX, undefined);
    assert.equal(mounted.originY, undefined);
    assert.equal(mounted.flipX, undefined);
    assert.equal(mounted.flipY, undefined);
    assert.equal(mounted.skewX, undefined);
    assert.equal(mounted.skewY, undefined);
    assert.equal(mounted.paperCenterline, undefined);
    assert.equal(mounted.paperCenterlineRuns, undefined);
    assert.equal(mounted.cmds, undefined);
    assert.equal(mounted.strokeDashArray, undefined);
    assert.equal(mounted.strokeDashOffset, undefined);
    assert.equal(mounted.left, 0);
    assert.deepEqual(mounted.path, pageSpaceSurvivor.path);
    const remoteAffine = createInkPathAffine(mounted, mounted.path);
    assert.deepEqual(
      remoteAffine.matrix,
      [1, 0, 0, 1, 0, 0],
      'the remote page-space survivor must map its baked path without a second transform',
    );
    assert.deepEqual(
      remoteAffine.point({ x: 25, y: 80 }),
      { x: 25, y: 80 },
      'the first surviving path point must remain at its exact baked page coordinate',
    );
    await Promise.resolve();
  } finally {
    docA.destroy();
    docB.destroy();
  }
});

test('geometry tombstones merge with a concurrent unrelated style edit per field', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const originA = origin(docA, 'eraser-a');
  const originB = origin(docB, 'stylist-b');

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      fabricObject('geometry-removal-ink', centerLocalInk),
      originA,
      { userId: 'eraser-a', deviceId: 'eraser-a-device' },
    );
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // A bakes geometry while B changes only the stroke color from the shared
    // base. B's unchanged geometry creates no new CRDT operations.
    applyFabricCommit(
      docA,
      annotationsA,
      fabricObject('geometry-removal-ink', pageSpaceSurvivor),
      originA,
      { userId: 'eraser-a', deviceId: 'eraser-a-device' },
    );
    applyFabricCommit(
      docB,
      annotationsB,
      fabricObject('geometry-removal-ink', {
        ...centerLocalInk,
        stroke: '#1455ff',
      }),
      originB,
      { userId: 'stylist-b', deviceId: 'stylist-b-device' },
    );

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    for (const annotations of [annotationsA, annotationsB]) {
      const fabricMap = annotations.get('geometry-removal-ink').get('fabric');
      assert.equal(fabricMap.get('stroke'), '#1455ff');
      assert.equal(fabricMap.get('inkGeometrySpace'), 'page');
      assert.equal(fabricMap.get('inkGeometryOrigin'), undefined);
      assert.equal(fabricMap.get('pathOffset'), undefined);
      assert.equal(fabricMap.get('originX'), undefined);
      assert.equal(fabricMap.get('originY'), undefined);
      assert.equal(fabricMap.get('flipX'), undefined);
      assert.equal(fabricMap.get('flipY'), undefined);
      assert.equal(fabricMap.get('skewX'), undefined);
      assert.equal(fabricMap.get('skewY'), undefined);
      assert.equal(fabricMap.get('cmds'), undefined);
      assert.deepEqual(fabricMap.get('path'), pageSpaceSurvivor.path);
    }
  } finally {
    docA.destroy();
    docB.destroy();
  }
});

test('geometry-key deletion remains exact through collaborator Undo and Redo', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const originA = origin(ydoc, 'creator-a');
  const {
    undoManager,
    origin: originB,
    dispose,
  } = createUndoManager({
    ydoc,
    userId: 'eraser-b',
    deviceId: 'eraser-b-device',
    sessionId: 'eraser-b-session',
    clientID: ydoc.clientID,
    captureTimeout: 0,
  });

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      fabricObject('geometry-removal-ink', centerLocalInk),
      originA,
      { userId: 'creator-a', deviceId: 'creator-a-device' },
    );
    applyFabricCommit(
      ydoc,
      annotations,
      fabricObject('geometry-removal-ink', pageSpaceSurvivor),
      originB,
      { userId: 'eraser-b', deviceId: 'eraser-b-device' },
    );
    undoManager.stopCapturing();

    const owners = ydoc
      .getMap('__annotationFabricFieldOwners')
      .get('geometry-removal-ink');
    const latestFields = ydoc
      .getMap('__annotationLatestFabricFields')
      .get('geometry-removal-ink');
    assert.equal(owners.get('inkGeometryOrigin'), 'eraser-b');
    assert.equal(latestFields.get('inkGeometryOrigin'), undefined);
    assert.equal(latestFields.has('inkGeometryOrigin'), true);

    userUndo(ydoc, undoManager, {
      userId: 'eraser-b',
      deviceId: 'eraser-b-device',
    });
    let fabricMap = annotations.get('geometry-removal-ink').get('fabric');
    assert.equal(fabricMap.get('inkGeometryOrigin'), 'center-v1');
    assert.deepEqual(fabricMap.get('pathOffset'), centerLocalInk.pathOffset);
    assert.equal(fabricMap.get('originX'), 'center');
    assert.equal(fabricMap.get('originY'), 'center');
    assert.equal(fabricMap.get('flipX'), true);
    assert.equal(fabricMap.get('flipY'), true);
    assert.equal(fabricMap.get('skewX'), 13);
    assert.equal(fabricMap.get('skewY'), -7);
    assert.equal(fabricMap.get('inkGeometrySpace'), 'local');
    assert.deepEqual(fabricMap.get('path'), centerLocalInk.path);
    assert.equal(latestFields.get('inkGeometryOrigin'), 'center-v1');

    userRedo(ydoc, undoManager, {
      userId: 'eraser-b',
      deviceId: 'eraser-b-device',
    });
    fabricMap = annotations.get('geometry-removal-ink').get('fabric');
    assert.equal(fabricMap.get('inkGeometryOrigin'), undefined);
    assert.equal(fabricMap.get('pathOffset'), undefined);
    assert.equal(fabricMap.get('originX'), undefined);
    assert.equal(fabricMap.get('originY'), undefined);
    assert.equal(fabricMap.get('flipX'), undefined);
    assert.equal(fabricMap.get('flipY'), undefined);
    assert.equal(fabricMap.get('skewX'), undefined);
    assert.equal(fabricMap.get('skewY'), undefined);
    assert.equal(fabricMap.get('inkGeometrySpace'), 'page');
    assert.deepEqual(fabricMap.get('path'), pageSpaceSurvivor.path);
    assert.equal(latestFields.get('inkGeometryOrigin'), undefined);
  } finally {
    dispose();
    ydoc.destroy();
  }
});
