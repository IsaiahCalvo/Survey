import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  deriveWriterEraserLane,
  docToByPage,
  getAnnotationsMap,
  writeAnnotationMark,
  getEraserOpsMap,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';

// RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
// — marks are nested per-field maps in the `marks` map (store v3). Tests that
// seeded a whole { p, o } value write it through the store instead; reads and
// deletes still go to the real map.
function markWriter(doc) {
  const map = getAnnotationsMap(doc);
  return {
    set(key, entry) { writeAnnotationMark(doc, key, entry.p, entry.o); },
    has: (key) => map.has(key),
    delete: (key) => map.delete(key),
    get size() { return map.size; },
  };
}
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

test('materialized partial-erase survivor stays page-space after durable lane replay', () => {
  const base = {
    id: 'imported-local-ink',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 50], ['C', 30, 20, 70, 80, 100, 50]],
    left: 25,
    top: 30,
    scaleX: 1,
    scaleY: 1,
    pathOffset: { x: 0, y: 0 },
    stroke: '#d11',
    strokeWidth: 12,
    fill: null,
    inkGeometrySpace: 'local',
    inkGeometryOrigin: 'center-v1',
    data: {
      id: 'imported-local-ink',
      inkGeometrySpace: 'local',
      inkGeometryOrigin: 'center-v1',
    },
  };
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [base] },
    eraserPoints: [{ x: 75, y: 74 }],
    eraserRadius: 6,
    mode: 'partial',
  });
  const mutation = erased.objectMutations[0];

  assert.equal(erased.didChange, true);
  assert.equal(mutation.survivor.inkGeometrySpace, 'page');
  assert.equal(mutation.survivor.data.inkGeometrySpace, 'page');
  assert.equal(mutation.survivor.inkGeometryOrigin, undefined);
  assert.equal(mutation.survivor.data.inkGeometryOrigin, undefined);
  assert.deepEqual(
    mutation.survivor.paperSourceStroke?.path,
    base.path,
    'the exact authored curve remains the render source',
  );
  assert.ok(
    mutation.survivor.paperEraserCuts?.length > 0,
    'the erased bite is persisted separately from the authored curve',
  );

  const doc = new Y.Doc();
  try {
    syncByPageToDoc(doc, { 1: { objects: [base] } });
    getEraserOpsMap(doc).set(
      'geometry-writer\u0000imported-local-ink',
      deriveWriterEraserLane({
        writerId: 'geometry-writer',
        storageKey: 'imported-local-ink',
        annotationId: 'imported-local-ink',
        pageNumber: 1,
        operationId: 'geometry-space-bite',
        baseObject: base,
        capturedBase: base,
        survivor: mutation.survivor,
        gesture: {
          mode: 'partial',
          points: [{ x: 75, y: 74 }],
          radius: 6,
        },
      }),
    );

    const materialized = docToByPage(doc)[1].objects[0];
    assert.equal(
      materialized.inkGeometrySpace,
      'page',
      'the stable base must not overwrite the survivor coordinate space',
    );
    assert.equal(materialized.data.inkGeometrySpace, 'page');
    assert.equal(materialized.inkGeometryOrigin, undefined);
    assert.equal(materialized.data.inkGeometryOrigin, undefined);
    assert.equal(materialized.left, 0);
    assert.equal(materialized.scaleX, 1);
    assert.deepEqual(
      materialized.paperSourceStroke,
      mutation.survivor.paperSourceStroke,
      'durable lane replay must preserve the exact source curve and its affine matrix',
    );
    assert.deepEqual(
      materialized.paperEraserCuts,
      mutation.survivor.paperEraserCuts,
      'durable lane replay must preserve every cut polygon exactly',
    );
  } finally {
    doc.destroy();
  }
});

test('materialized dashed hairline never regains source dash attributes during lane replay', () => {
  const base = {
    id: 'durable-dashed-hairline',
    annotationId: 'durable-dashed-hairline',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: '#111',
    strokeWidth: 0,
    strokeDashArray: [10, 10],
    strokeDashOffset: 0,
    strokeLineCap: 'butt',
    pdfStrokeHairline: true,
    data: {
      id: 'durable-dashed-hairline',
      tool: 'pen',
      pdfStrokeHairline: true,
    },
  };
  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [base] },
    eraserPoints: [{ x: 5, y: 0 }],
    eraserRadius: 1,
    mode: 'partial',
  });
  const survivor = erased.objectMutations[0]?.survivor;
  assert.equal(erased.didChange, true);
  assert.equal(survivor.strokeDashArray, undefined);
  assert.equal(survivor.strokeDashOffset, undefined);

  const doc = new Y.Doc();
  try {
    syncByPageToDoc(doc, { 1: { objects: [base] } });
    getEraserOpsMap(doc).set(
      'geometry-writer\u0000durable-dashed-hairline',
      deriveWriterEraserLane({
        writerId: 'geometry-writer',
        storageKey: 'durable-dashed-hairline',
        annotationId: 'durable-dashed-hairline',
        pageNumber: 1,
        operationId: 'durable-dash-bite',
        baseObject: base,
        capturedBase: base,
        survivor,
        gesture: {
          mode: 'partial',
          points: [{ x: 5, y: 0 }],
          radius: 1,
        },
      }),
    );

    const materialized = docToByPage(doc)[1].objects[0];
    assert.equal(materialized.strokeDashArray, undefined);
    assert.equal(materialized.strokeDashOffset, undefined);
    const oldGap = erasePageAnnotations({
      pageAnnotations: { objects: [materialized] },
      eraserPoints: [{ x: 15, y: 0 }],
      eraserRadius: 1,
      mode: 'full',
    });
    assert.equal(
      oldGap.didChange,
      false,
      'the original gap stays empty instead of restarting the old dash phase',
    );

    markWriter(doc).set('durable-dashed-hairline', { // RULED 2026-09-24 (owner: no users, no old-build compatibility; per-field storage)
      p: 1,
      o: {
        ...base,
        left: 20,
      },
    });
    const movedMaterialized = docToByPage(doc)[1].objects[0];
    assert.equal(movedMaterialized.strokeDashArray, undefined);
    assert.equal(movedMaterialized.strokeDashOffset, undefined);
    assert.equal(
      movedMaterialized.path[0][1],
      materialized.path[0][1] + 20,
      'the analytic survivor follows a later base transform without restoring dash state',
    );
  } finally {
    doc.destroy();
  }
});

test('two dashed-hairline writer lanes compose both analytic bites without deleting the stroke', () => {
  const base = {
    id: 'two-writer-dashed-hairline',
    annotationId: 'two-writer-dashed-hairline',
    type: 'path',
    tool: 'pen',
    path: [['M', 0, 0], ['L', 100, 0]],
    left: 0,
    top: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    stroke: '#111',
    strokeWidth: 0,
    strokeDashArray: [10, 10],
    strokeDashOffset: 0,
    strokeLineCap: 'butt',
    pdfStrokeHairline: true,
    data: {
      id: 'two-writer-dashed-hairline',
      tool: 'pen',
      pdfStrokeHairline: true,
    },
  };
  const makeLane = (writerId, x) => {
    const erased = erasePageAnnotations({
      pageAnnotations: { objects: [base] },
      eraserPoints: [{ x, y: 0 }],
      eraserRadius: 1,
      mode: 'partial',
    });
    return deriveWriterEraserLane({
      writerId,
      storageKey: 'two-writer-dashed-hairline',
      annotationId: 'two-writer-dashed-hairline',
      pageNumber: 1,
      operationId: `${writerId}-bite`,
      baseObject: base,
      capturedBase: base,
      survivor: erased.objectMutations[0].survivor,
      gesture: {
        mode: 'partial',
        points: [{ x, y: 0 }],
        radius: 1,
      },
    });
  };

  const doc = new Y.Doc();
  try {
    syncByPageToDoc(doc, { 1: { objects: [base] } });
    getEraserOpsMap(doc).set(
      'writer-a\u0000two-writer-dashed-hairline',
      makeLane('writer-a', 5),
    );
    getEraserOpsMap(doc).set(
      'writer-b\u0000two-writer-dashed-hairline',
      makeLane('writer-b', 25),
    );
    const materialized = docToByPage(doc)[1].objects[0];
    assert.ok(materialized, 'independent analytic lanes must not whole-delete the hairline');
    assert.equal(materialized.strokeDashArray, undefined);

    for (const x of [5, 15, 25]) {
      const erasedGap = erasePageAnnotations({
        pageAnnotations: { objects: [materialized] },
        eraserPoints: [{ x, y: 0 }],
        eraserRadius: 0.4,
        mode: 'full',
      });
      assert.equal(erasedGap.didChange, false, `x=${x} stays empty`);
    }
    const remainingPaint = erasePageAnnotations({
      pageAnnotations: { objects: [materialized] },
      eraserPoints: [{ x: 1, y: 0 }],
      eraserRadius: 0.1,
      mode: 'full',
    });
    assert.deepEqual(
      remainingPaint.deletedIds,
      ['two-writer-dashed-hairline'],
      'unbitten paint remains after both lanes compose',
    );
  } finally {
    doc.destroy();
  }
});

test('same-writer commit accepts the worker survivor without replaying its cut', () => {
  const base = {
    id: 'worker-survivor',
    type: 'path',
    path: [['M', 0, 50], ['L', 120, 50]],
    left: 0,
    top: 0,
    stroke: '#111',
    strokeWidth: 18,
    fill: null,
    data: { id: 'worker-survivor', tool: 'pen' },
  };
  const firstPoint = { x: 35, y: 50 };
  const first = erasePageAnnotations({
    pageAnnotations: { objects: [base] },
    eraserPoints: [firstPoint],
    eraserRadius: 6,
    mode: 'partial',
  }).objectMutations[0].survivor;
  const previousLane = deriveWriterEraserLane({
    writerId: 'writer-a',
    storageKey: 'worker-survivor',
    annotationId: 'worker-survivor',
    pageNumber: 1,
    operationId: 'first',
    baseObject: base,
    capturedBase: base,
    survivor: first,
    gesture: { mode: 'partial', points: [firstPoint], radius: 6 },
  });
  const secondPoint = { x: 80, y: 50 };
  const second = erasePageAnnotations({
    pageAnnotations: { objects: [first] },
    eraserPoints: [secondPoint],
    eraserRadius: 6,
    mode: 'partial',
  }).objectMutations[0].survivor;

  const lane = deriveWriterEraserLane({
    writerId: 'writer-a',
    storageKey: 'worker-survivor',
    annotationId: 'worker-survivor',
    pageNumber: 1,
    operationId: 'second',
    baseObject: base,
    capturedBase: first,
    previousLane,
    survivor: second,
    preferCapturedSurvivor: true,
    // A replay of this point cannot create `second`; the trusted worker result
    // must win on the no-foreign-writer path.
    gesture: { mode: 'partial', points: [{ x: 500, y: 500 }], radius: 2 },
  });

  assert.deepEqual(lane.survivor.paperEraserCuts, second.paperEraserCuts);
});
