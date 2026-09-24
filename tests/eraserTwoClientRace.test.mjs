import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';

import {
  docToByPage,
  getAnnotationsMap,
  getEraserOpsMap,
  readAnnotationEntry,
  readAnnotationObject,
  syncByPageToDoc,
  writeAnnotationMark,
} from '../src/services/annotationDocStore.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { isEraserPreviewFinishReady } from '../src/utils/eraserPreviewHandoff.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';

const nativeInk = (id = 'ink', overrides = {}) => ({
  ...createProductionPaperInk({
    id,
    tool: 'pen',
    points: [{ x: 0, y: 50 }, { x: 100, y: 50 }],
    color: '#d11b2d',
    width: 20,
  }),
  ...overrides,
});

const page = (...objects) => ({ 1: { objects } });

function cloneDoc(source) {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function pointInRing({ x, y }, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygonSet(point, polygons) {
  return (polygons || []).some((polygon) => (
    polygon.reduce((inside, ring) => (pointInRing(point, ring) ? !inside : inside), false)
  ));
}

function prepareErase(before, {
  id,
  points,
  radius = 7,
} = {}) {
  const result = erasePageAnnotations({
    pageAnnotations: before[1],
    eraserPoints: points,
    eraserRadius: radius,
    mode: 'partial',
  });
  return {
    result,
    byPage: {
      ...before,
      1: {
        ...result.pageAnnotations,
        eraserMutation: {
          id,
          pageNumber: 1,
          points,
          radius,
          mode: 'partial',
          touchedIds: result.touchedIds,
          changedIds: result.changedIds,
          deletedIds: result.deletedIds,
          objectMutations: result.objectMutations,
        },
      },
    },
  };
}

function commitPreparedErase(doc, before, prepared, writerId) {
  return syncByPageToDoc(doc, prepared.byPage, {
    prevByPage: before,
    eraserWriterId: writerId,
  });
}

function replaceDurableBase(doc, storageKey, object, origin = 'remote-base-edit') {
  // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
  // — a remote base edit writes the mark's differing fields, not a whole entry.
  const entry = readAnnotationEntry(doc, storageKey);
  doc.transact(() => {
    writeAnnotationMark(doc, storageKey, entry.p, object);
  }, origin);
}

const FLOAT_SIGN_BIT = 1n << 63n;
const FLOAT_MASK = (1n << 64n) - 1n;
const floatBitsBuffer = new ArrayBuffer(8);
const floatBitsView = new DataView(floatBitsBuffer);

function orderedFloatBits(value) {
  floatBitsView.setFloat64(0, value, false);
  const bits = floatBitsView.getBigUint64(0, false);
  return (bits & FLOAT_SIGN_BIT) !== 0n
    ? (~bits) & FLOAT_MASK
    : bits | FLOAT_SIGN_BIT;
}

function floatUlpDistance(left, right) {
  if (left === right) return 0n;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return FLOAT_MASK;
  const leftBits = orderedFloatBits(left);
  const rightBits = orderedFloatBits(right);
  return leftBits >= rightBits ? leftBits - rightBits : rightBits - leftBits;
}

function assertPolygonsWithinUlps(actual, expected, maxUlps = 1n) {
  assert.equal(actual.length, expected.length);
  for (let polygonIndex = 0; polygonIndex < actual.length; polygonIndex += 1) {
    assert.equal(actual[polygonIndex].length, expected[polygonIndex].length);
    for (let ringIndex = 0; ringIndex < actual[polygonIndex].length; ringIndex += 1) {
      assert.equal(
        actual[polygonIndex][ringIndex].length,
        expected[polygonIndex][ringIndex].length,
      );
      for (let pointIndex = 0; pointIndex < actual[polygonIndex][ringIndex].length; pointIndex += 1) {
        for (let axis = 0; axis < 2; axis += 1) {
          const left = actual[polygonIndex][ringIndex][pointIndex][axis];
          const right = expected[polygonIndex][ringIndex][pointIndex][axis];
          assert.ok(
            floatUlpDistance(left, right) <= maxUlps,
            `polygon ${polygonIndex}/${ringIndex}/${pointIndex}/${axis}: ${left} vs ${right}`,
          );
        }
      }
    }
  }
}

test('preview handoff requires the exact durable mutation acknowledgment', () => {
  const expectedRevision = 'eraser:writer-a:1';
  const gate = (overrides = {}) => isEraserPreviewFinishReady({
    expectedRevision,
    waitForNextPaint: true,
    finalSvgRevision: expectedRevision,
    materializedMutationIds: [],
    requireMutationAck: true,
    maskClone: true,
    hadSourceAtRelease: true,
    hasCurrentSource: true,
    ...overrides,
  });

  assert.equal(gate(), false);
  assert.equal(gate({ materializedMutationIds: ['remote:other'] }), false);
  assert.equal(gate({ hasCurrentSource: false }), false, 'remote source removal is not a local ack');
  assert.equal(gate({ materializedMutationIds: [expectedRevision] }), true);
});

test('independent same-target lanes converge and acknowledge both writers', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('shared')));
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const beforeA = docToByPage(clientA);
  const beforeB = docToByPage(clientB);
  const eraseA = prepareErase(beforeA, {
    id: 'eraser:writer-a:1',
    points: [{ x: 35, y: 38 }],
  });
  const eraseB = prepareErase(beforeB, {
    id: 'eraser:writer-b:1',
    points: [{ x: 70, y: 62 }],
  });

  commitPreparedErase(clientA, beforeA, eraseA, 'writer-a');
  commitPreparedErase(clientB, beforeB, eraseB, 'writer-b');
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB));
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA));

  const materializedA = docToByPage(clientA);
  const materializedB = docToByPage(clientB);
  assert.deepEqual(materializedA, materializedB);
  assert.deepEqual(
    materializedA[1].eraserMaterializedMutationIds,
    ['eraser:writer-a:1', 'eraser:writer-b:1'],
  );
  assert.equal(pointInPolygonSet({ x: 35, y: 41 }, materializedA[1].objects[0].polygons), false);
  assert.equal(pointInPolygonSet({ x: 70, y: 59 }, materializedA[1].objects[0].polygons), false);
});

test('held-pointer stale erase rebases onto a remote move/style edit and survives cold reload', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('moving')));
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);

  // Client A computes against pointer-down geometry but does not commit yet.
  const staleA = docToByPage(clientA);
  const localErase = prepareErase(staleA, {
    id: 'eraser:writer-a:held',
    points: [{ x: 35, y: 38 }],
  });

  // While A still holds the pointer, B moves and restyles the same base.
  const beforeB = docToByPage(clientB);
  const remotelyMoved = {
    ...readAnnotationObject(clientB, 'moving'), // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    left: 120,
    fill: '#0055ff',
    data: { id: 'moving', tool: 'pen', remoteEdit: true },
  };
  syncByPageToDoc(clientB, page(remotelyMoved), { prevByPage: beforeB });
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB), 'remote-before-release');

  // A releases after the remote update. Its immutable stale intent must move
  // with the remote base instead of overwriting or erasing the old position.
  commitPreparedErase(clientA, staleA, localErase, 'writer-a');
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA), 'local-release');

  const expected = erasePageAnnotations({
    pageAnnotations: { objects: [remotelyMoved] },
    eraserPoints: [{ x: 155, y: 38 }],
    eraserRadius: 7,
    mode: 'partial',
  }).pageAnnotations.objects[0];
  const actualA = docToByPage(clientA);
  const actualB = docToByPage(clientB);
  assert.deepEqual(actualA, actualB);
  // The held-gesture rebase and direct latest-state erase use a different
  // floating operation order. Permit exactly one representable double step;
  // A/B convergence and cold reload remain byte-exact assertions.
  assertPolygonsWithinUlps(actualA[1].objects[0].polygons, expected.polygons);
  assert.equal(actualA[1].objects[0].fill, '#0055ff');
  assert.equal(actualA[1].objects[0].data.remoteEdit, true);
  assert.deepEqual(actualA[1].eraserMaterializedMutationIds, ['eraser:writer-a:held']);

  const reopened = cloneDoc(clientA);
  assert.deepEqual(docToByPage(reopened), actualA);
  assert.equal(getAnnotationsMap(reopened).size, 1, 'stable moved base remains durable');
  assert.equal(getEraserOpsMap(reopened).size, 1, 'one bounded survivor lane remains durable');
});

test('a second held erase on baked geometry follows a remote base move exactly', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('twice')));
  const clientA = cloneDoc(seed);
  const firstBefore = docToByPage(clientA);
  const first = prepareErase(firstBefore, {
    id: 'eraser:writer-a:first',
    points: [{ x: 35, y: 38 }],
  });
  commitPreparedErase(clientA, firstBefore, first, 'writer-a');
  const clientB = cloneDoc(clientA);

  const staleSecondBefore = docToByPage(clientA);
  assert.equal(staleSecondBefore[1].objects[0].paperEraserGeometry, 'v1');
  const staleSecond = prepareErase(staleSecondBefore, {
    id: 'eraser:writer-a:second',
    points: [{ x: 70, y: 62 }],
  });
  const movedBase = {
    ...readAnnotationObject(clientB, 'twice'), // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    left: 120,
    fill: '#0055ff',
    data: { id: 'twice', tool: 'pen', remoteEdit: true },
  };
  replaceDurableBase(clientB, 'twice', movedBase);
  const movedFirstBite = docToByPage(clientB);
  const expected = erasePageAnnotations({
    pageAnnotations: movedFirstBite[1],
    eraserPoints: [{ x: 190, y: 62 }],
    eraserRadius: 7,
    mode: 'partial',
  }).pageAnnotations.objects[0];

  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB), 'remote-move-before-second-release');
  commitPreparedErase(clientA, staleSecondBefore, staleSecond, 'writer-a');
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA), 'second-release');

  const actual = docToByPage(clientA);
  assert.deepEqual(actual, docToByPage(clientB));
  assertPolygonsWithinUlps(actual[1].objects[0].polygons, expected.polygons);
  assert.equal(actual[1].objects[0].fill, '#0055ff');
  assert.equal(actual[1].objects[0].data.remoteEdit, true);
  assert.deepEqual(
    actual[1].eraserMaterializedMutationIds,
    ['eraser:writer-a:second'],
  );
  assert.deepEqual(docToByPage(cloneDoc(clientA)), actual);
  assert.equal(getEraserOpsMap(clientA).size, 1, 'second gesture replaces the bounded lane');
});

test('compatible scale and rotation apply a full affine rebase to the stale survivor', () => {
  const seed = new Y.Doc();
  const base = nativeInk('affine');
  syncByPageToDoc(seed, page(base));
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const staleBefore = docToByPage(clientA);
  const stale = prepareErase(staleBefore, {
    id: 'eraser:writer-a:affine',
    points: [{ x: 35, y: 38 }],
  });
  const transformedBase = {
    ...readAnnotationObject(clientB, 'affine'), // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
    left: 40,
    top: 15,
    scaleX: 1.4,
    scaleY: 0.75,
    angle: 30,
    fill: '#0055ff',
  };
  replaceDurableBase(clientB, 'affine', transformedBase);
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB), 'remote-affine-before-release');
  commitPreparedErase(clientA, staleBefore, stale, 'writer-a');

  const radians = transformedBase.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const expectedPolygons = stale.result.pageAnnotations.objects[0].polygons.map(
    (polygon) => polygon.map((ring) => ring.map(([x, y]) => {
      const dx = transformedBase.scaleX * (x - 50);
      const dy = transformedBase.scaleY * (y - 50);
      return [
        transformedBase.left + transformedBase.scaleX * 50 + dx * cos - dy * sin,
        transformedBase.top + transformedBase.scaleY * 50 + dx * sin + dy * cos,
      ];
    })),
  );
  const actual = docToByPage(clientA)[1].objects[0];
  // The independent expectation multiplies the affine in a different
  // arithmetic order than the production inverse→forward rebase. IEEE-754
  // permits a handful of ULPs of association drift; keep this microscopic
  // and explicit instead of the former 8-decimal rounding (~350k ULPs).
  assertPolygonsWithinUlps(actual.polygons, expectedPolygons, 16n);
  assert.equal(actual.fill, '#0055ff');
  assert.deepEqual(docToByPage(cloneDoc(clientA))[1].objects[0].polygons, actual.polygons);
});

test('an incompatible remote geometry edit wins instead of reviving the stale path', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('reshaped')));
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const staleBefore = docToByPage(clientA);
  const stale = prepareErase(staleBefore, {
    id: 'eraser:writer-a:stale-geometry',
    points: [{ x: 35, y: 38 }],
  });
  const remoteGeometry = createProductionPaperInk({
    id: 'reshaped',
    tool: 'pen',
    points: [{ x: 10, y: 85 }, { x: 120, y: 70 }],
    color: '#008844',
    width: 12,
    data: { remoteGeometryEdit: true },
  });
  replaceDurableBase(clientB, 'reshaped', remoteGeometry);
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB), 'remote-geometry-before-release');
  commitPreparedErase(clientA, staleBefore, stale, 'writer-a');

  const actual = docToByPage(clientA)[1];
  assert.deepEqual(actual.objects[0].polygons, remoteGeometry.polygons);
  assert.equal(actual.objects[0].fill, '#008844');
  assert.equal(actual.objects[0].data.remoteGeometryEdit, true);
  assert.deepEqual(
    actual.eraserMaterializedMutationIds,
    ['eraser:writer-a:stale-geometry'],
  );
  assert.deepEqual(docToByPage(cloneDoc(clientA))[1], actual);
});

test('an incompatible non-polygon Fabric replacement survives instead of disappearing', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('fabric-replacement')));
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const staleBefore = docToByPage(clientA);
  const stale = prepareErase(staleBefore, {
    id: 'eraser:writer-a:ordinary-path-replacement',
    points: [{ x: 35, y: 38 }],
  });
  const remoteGeometry = {
    type: 'path',
    path: [['M', 10, 85], ['L', 120, 70]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    fill: null,
    stroke: '#008844',
    strokeWidth: 12,
    data: {
      id: 'fabric-replacement',
      tool: 'pen',
      remoteGeometryEdit: true,
    },
  };
  replaceDurableBase(clientB, 'fabric-replacement', remoteGeometry);
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB), 'remote-fabric-path-before-release');
  commitPreparedErase(clientA, staleBefore, stale, 'writer-a');

  const actual = docToByPage(clientA)[1];
  assert.equal(actual.objects.length, 1);
  assert.deepEqual(actual.objects[0].path, remoteGeometry.path);
  assert.equal(actual.objects[0].stroke, '#008844');
  assert.equal(actual.objects[0].polygons, undefined);
  assert.equal(actual.objects[0].data.remoteGeometryEdit, true);
  assert.deepEqual(
    actual.eraserMaterializedMutationIds,
    ['eraser:writer-a:ordinary-path-replacement'],
  );
  assert.deepEqual(docToByPage(cloneDoc(clientA))[1], actual);
});

test('a stale lane is ignored while a newer writer erases the replacement geometry', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('multi-generation')));
  const staleClient = cloneDoc(seed);
  const replacementClient = cloneDoc(seed);
  const staleBefore = docToByPage(staleClient);
  const stale = prepareErase(staleBefore, {
    id: 'eraser:writer-a:old-generation',
    points: [{ x: 35, y: 38 }],
  });
  const remoteGeometry = {
    type: 'path',
    path: [['M', 10, 85], ['L', 120, 70]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    fill: null,
    stroke: '#008844',
    strokeWidth: 12,
    data: {
      id: 'multi-generation',
      tool: 'pen',
      remoteGeometryEdit: true,
    },
  };
  replaceDurableBase(replacementClient, 'multi-generation', remoteGeometry);
  Y.applyUpdate(staleClient, Y.encodeStateAsUpdate(replacementClient), 'remote-generation');
  commitPreparedErase(staleClient, staleBefore, stale, 'writer-a');

  const newWriter = cloneDoc(staleClient);
  const replacementBefore = docToByPage(newWriter);
  const replacementErase = prepareErase(replacementBefore, {
    id: 'eraser:writer-b:new-generation',
    points: [{ x: 65, y: 78 }],
    radius: 4,
  });
  assert.equal(replacementErase.result.didChange, true);
  commitPreparedErase(newWriter, replacementBefore, replacementErase, 'writer-b');
  Y.applyUpdate(staleClient, Y.encodeStateAsUpdate(newWriter), 'new-generation-erase');
  Y.applyUpdate(newWriter, Y.encodeStateAsUpdate(staleClient), 'merge-stale-lane');

  const actual = docToByPage(staleClient);
  const expected = replacementErase.result.pageAnnotations.objects[0];
  assert.deepEqual(actual, docToByPage(newWriter));
  assert.deepEqual(actual[1].objects[0].polygons, expected.polygons);
  assert.equal(actual[1].objects[0].fill, '#008844');
  assert.deepEqual(
    actual[1].eraserMaterializedMutationIds,
    ['eraser:writer-a:old-generation', 'eraser:writer-b:new-generation'],
  );
  assert.deepEqual(docToByPage(cloneDoc(staleClient)), actual);
});

test('remote base deletion during a held gesture wins without resurrection', () => {
  const seed = new Y.Doc();
  syncByPageToDoc(seed, page(nativeInk('target'), nativeInk('neighbor', { top: 100 })));
  const clientA = cloneDoc(seed);
  const clientB = cloneDoc(seed);
  const staleA = docToByPage(clientA);
  const localErase = prepareErase(staleA, {
    id: 'eraser:writer-a:delete-race',
    points: [{ x: 35, y: 38 }],
  });

  const beforeB = docToByPage(clientB);
  syncByPageToDoc(clientB, page(beforeB[1].objects[1]), { prevByPage: beforeB });
  Y.applyUpdate(clientA, Y.encodeStateAsUpdate(clientB), 'remote-delete-before-release');
  commitPreparedErase(clientA, staleA, localErase, 'writer-a');
  Y.applyUpdate(clientB, Y.encodeStateAsUpdate(clientA), 'local-release');

  for (const doc of [clientA, clientB, cloneDoc(clientA)]) {
    const materialized = docToByPage(doc);
    assert.deepEqual(materialized[1].objects.map((object) => object.data.id), ['neighbor']);
    assert.deepEqual(
      materialized[1].eraserMaterializedMutationIds,
      ['eraser:writer-a:delete-race'],
    );
  }
});

test('sequential same-writer gestures remain one bounded lane with only the current acknowledgment', () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, page(nativeInk('bounded')));

  for (let index = 0; index < 12; index += 1) {
    const before = docToByPage(doc);
    const prepared = prepareErase(before, {
      id: `eraser:writer-a:${index}`,
      points: [{ x: 8 + index * 7, y: index % 2 === 0 ? 38 : 62 }],
      radius: 3,
    });
    commitPreparedErase(doc, before, prepared, 'writer-a');
  }

  const [lane] = [...getEraserOpsMap(doc).values()];
  assert.equal(getEraserOpsMap(doc).size, 1);
  assert.equal(lane.operationId, 'eraser:writer-a:11');
  assert.equal('operations' in lane, false, 'the lane does not grow a gesture replay log');
  assert.deepEqual(
    docToByPage(doc)[1].eraserMaterializedMutationIds,
    ['eraser:writer-a:11'],
  );
});

test('annotation handle captures and materializes an eraser mutation synchronously', async () => {
  const handle = await openAnnotationDoc({
    actorUserId: 'race-test',
    documentId: 'race-sync-capture',
    clientId: 'same-install',
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
  });
  handle.applyByPage(page(nativeInk('immediate')));
  const before = handle.getByPage();
  const prepared = prepareErase(before, {
    id: 'eraser:writer-a:immediate',
    points: [{ x: 50, y: 38 }],
  });

  const materialized = handle.applyEraserMutation(
    1,
    prepared.result.pageAnnotations,
    prepared.byPage[1].eraserMutation,
  );
  assert.deepEqual(
    materialized.eraserMaterializedMutationIds,
    ['eraser:writer-a:immediate'],
  );
  assert.deepEqual(handle.getByPage()[1], materialized);
  await handle.destroy();
});
