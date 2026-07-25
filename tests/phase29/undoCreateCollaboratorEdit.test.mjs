import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import {
  applyFabricCommit,
  applyFabricDelete,
} from '../../src/lib/collab/crdtAnnotationBridge.js';
import {
  createUndoManager,
  userRedo,
  userUndo,
} from '../../src/lib/collab/crdtUndoManager.js';

function makeInk(id, values) {
  return {
    data: { id },
    pageNumber: 1,
    toObject: () => ({
      type: 'path',
      data: { id },
      ...values,
    }),
  };
}

test('undoing A create never deletes B later geometry edit; redo also preserves B state', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const ctxA = {
    userId: 'creator-a',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: docA.clientID,
  };
  const ctxB = {
    userId: 'editor-b',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: docB.clientID,
  };
  const {
    undoManager: undoA,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });

  const originalPolygons = [[[[0, 0], [24, 0], [24, 8], [0, 0]]]];
  const collaboratorPolygons = [[[[0, 0], [17, 0], [17, 8], [0, 0]]]];
  const exactLegacyCommands = [
    ['M', 0, 4],
    ['C', 4, -2, 12, 10, 24, 4],
  ];

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      makeInk('shared-ink', {
        left: 10,
        top: 20,
        polygons: originalPolygons,
        cmds: exactLegacyCommands,
      }),
      originA,
      ctxA,
    );
    undoA.stopCapturing();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    applyFabricCommit(
      docB,
      annotationsB,
      makeInk('shared-ink', {
        left: 37,
        top: 20,
        polygons: collaboratorPolygons,
        cmds: exactLegacyCommands,
      }),
      originB,
      ctxB,
    );
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    userUndo(docA, undoA, ctxA);

    const afterUndo = annotationsA.get('shared-ink');
    assert.ok(afterUndo, 'A undo-create must not delete an annotation B later edited');
    const fabricAfterUndo = afterUndo.get('fabric');
    assert.equal(fabricAfterUndo.get('left'), 37);
    assert.equal(fabricAfterUndo.get('top'), 20);
    assert.deepEqual(fabricAfterUndo.get('polygons'), collaboratorPolygons);
    assert.deepEqual(fabricAfterUndo.get('cmds'), exactLegacyCommands);
    assert.equal(afterUndo.get('meta').get('authorId'), 'creator-a');
    assert.equal(afterUndo.get('meta').get('lastEditorId'), 'editor-b');

    userRedo(docA, undoA, ctxA);

    const afterRedo = annotationsA.get('shared-ink');
    assert.ok(afterRedo, 'A redo must not replace or delete B-owned annotation state');
    assert.equal(afterRedo.get('fabric').get('left'), 37);
    assert.deepEqual(afterRedo.get('fabric').get('polygons'), collaboratorPolygons);
    assert.deepEqual(afterRedo.get('fabric').get('cmds'), exactLegacyCommands);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    assert.equal(annotationsB.get('shared-ink').get('fabric').get('left'), 37);
    assert.deepEqual(
      annotationsB.get('shared-ink').get('fabric').get('polygons'),
      collaboratorPolygons,
      'both collaborators must converge on B geometry after A Undo/Redo',
    );
  } finally {
    disposeA();
    disposeB();
    docA.destroy();
    docB.destroy();
  }
});

test('style-only collaborator edit protects the shared annotation from creator Undo/Redo', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctxA = {
    userId: 'style-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: ydoc.clientID,
  };
  const ctxB = {
    userId: 'style-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: ydoc.clientID,
  };
  const {
    undoManager,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc, ...ctxB, captureTimeout: 0 });

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('styled-ink', { left: 4, top: 8, fill: '#000000' }),
      originA,
      ctxA,
    );
    undoManager.stopCapturing();
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('styled-ink', { left: 4, top: 8, fill: '#ff0000' }),
      originB,
      ctxB,
    );

    userUndo(ydoc, undoManager, ctxA);
    assert.equal(annotations.get('styled-ink').get('fabric').get('fill'), '#ff0000');
    assert.equal(annotations.get('styled-ink').get('fabric').get('left'), 4);

    userRedo(ydoc, undoManager, ctxA);
    assert.equal(annotations.get('styled-ink').get('fabric').get('fill'), '#ff0000');
    assert.equal(annotations.get('styled-ink').get('fabric').get('left'), 4);
  } finally {
    disposeA();
    disposeB();
    ydoc.destroy();
  }
});

test('B delete stays deleted when A later Undo/Redo its original create', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const ctxA = {
    userId: 'delete-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: docA.clientID,
  };
  const ctxB = {
    userId: 'delete-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: docB.clientID,
  };
  const {
    undoManager,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      makeInk('deleted-ink', { left: 5, top: 7, fill: '#222222' }),
      originA,
      ctxA,
    );
    undoManager.stopCapturing();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    applyFabricDelete(docB, annotationsB, 'deleted-ink', originB);
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    assert.equal(annotationsA.has('deleted-ink'), false);

    userUndo(docA, undoManager, ctxA);
    assert.equal(
      annotationsA.has('deleted-ink'),
      false,
      'A undo-create must not resurrect B-deleted annotation',
    );
    userRedo(docA, undoManager, ctxA);
    assert.equal(
      annotationsA.has('deleted-ink'),
      false,
      'A redo-create must not override B deletion',
    );
  } finally {
    disposeA();
    disposeB();
    docA.destroy();
    docB.destroy();
  }
});

test('untouched A-created annotation still disappears on Undo and returns on Redo', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctxA = {
    userId: 'solo-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: ydoc.clientID,
  };
  const {
    undoManager,
    origin,
    dispose,
  } = createUndoManager({ ydoc, ...ctxA, captureTimeout: 0 });

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('solo-ink', { left: 3, top: 9, fill: '#333333' }),
      origin,
      ctxA,
    );
    undoManager.stopCapturing();

    userUndo(ydoc, undoManager, ctxA);
    assert.equal(annotations.has('solo-ink'), false);

    userRedo(ydoc, undoManager, ctxA);
    assert.equal(annotations.get('solo-ink').get('fabric').get('left'), 3);
    assert.equal(annotations.get('solo-ink').get('fabric').get('fill'), '#333333');
  } finally {
    dispose();
    ydoc.destroy();
  }
});

test('undo-create reconciles from current state after an earlier local edit was undone', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctxA = {
    userId: 'chain-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: ydoc.clientID,
  };
  const ctxB = {
    userId: 'chain-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: ydoc.clientID,
  };
  const {
    undoManager,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc, ...ctxB, captureTimeout: 0 });

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('chain-ink', { left: 10, top: 2, fill: '#000000' }),
      originA,
      ctxA,
    );
    undoManager.stopCapturing();
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('chain-ink', { left: 10, top: 2, fill: '#ff0000' }),
      originB,
      ctxB,
    );
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('chain-ink', { left: 99, top: 2, fill: '#ff0000' }),
      originA,
      ctxA,
    );
    undoManager.stopCapturing();

    userUndo(ydoc, undoManager, ctxA);
    assert.equal(annotations.get('chain-ink').get('fabric').get('left'), 10);

    userUndo(ydoc, undoManager, ctxA);
    const afterCreateUndo = annotations.get('chain-ink').get('fabric');
    assert.equal(
      afterCreateUndo.get('left'),
      10,
      'reconcile must not restore stale left=99 from the previously undone edit',
    );
    assert.equal(afterCreateUndo.get('fill'), '#ff0000');
  } finally {
    disposeA();
    disposeB();
    ydoc.destroy();
  }
});

test('collaborator no-op commit does not falsely protect an untouched create', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctxA = {
    userId: 'noop-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: ydoc.clientID,
  };
  const ctxB = {
    userId: 'noop-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: ydoc.clientID,
  };
  const {
    undoManager,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc, ...ctxB, captureTimeout: 0 });

  try {
    const unchanged = () => ({
      left: 6,
      top: 7,
      fill: '#123456',
      path: [
        ['M', 0, 0],
        ['C', 3, 4, 7, 8, 10, 2],
      ],
      polygons: [[[[0, 0], [12, 0], [12, 4], [0, 0]]]],
    });
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('noop-ink', unchanged()),
      originA,
      ctxA,
    );
    undoManager.stopCapturing();
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('noop-ink', unchanged()),
      originB,
      ctxB,
    );

    userUndo(ydoc, undoManager, ctxA);
    assert.equal(
      annotations.has('noop-ink'),
      false,
      'meta.lastEditorId alone is not collaborator-owned annotation content',
    );
  } finally {
    disposeA();
    disposeB();
    ydoc.destroy();
  }
});

test('once B undoes its edit, A may undo the now-unshared create normally', () => {
  const ydoc = new Y.Doc();
  const annotations = ydoc.getMap('annotations');
  const ctxA = {
    userId: 'reverted-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: ydoc.clientID,
  };
  const ctxB = {
    userId: 'reverted-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: ydoc.clientID,
  };
  const {
    undoManager: undoA,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc, ...ctxA, captureTimeout: 0 });
  const {
    undoManager: undoB,
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc, ...ctxB, captureTimeout: 0 });

  try {
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('reverted-ink', { left: 1, top: 2, fill: '#000000' }),
      originA,
      ctxA,
    );
    undoA.stopCapturing();
    applyFabricCommit(
      ydoc,
      annotations,
      makeInk('reverted-ink', { left: 40, top: 2, fill: '#000000' }),
      originB,
      ctxB,
    );
    undoB.stopCapturing();

    userUndo(ydoc, undoB, ctxB);
    assert.equal(annotations.get('reverted-ink').get('fabric').get('left'), 1);
    assert.equal(
      ydoc
        .getMap('__annotationLatestFabricFields')
        .get('reverted-ink')
        .get('left'),
      1,
      'latest field value must undo with its owning Fabric field',
    );

    userUndo(ydoc, undoA, ctxA);
    assert.equal(
      annotations.has('reverted-ink'),
      false,
      'B no longer owns visible state after undoing its edit',
    );
  } finally {
    disposeA();
    disposeB();
    ydoc.destroy();
  }
});

test('late-sync B edit survives when A already undid the create while offline', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const ctxA = {
    userId: 'offline-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: docA.clientID,
  };
  const ctxB = {
    userId: 'offline-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: docB.clientID,
  };
  const {
    undoManager: undoA,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      makeInk('offline-ink', { left: 3, top: 4, fill: '#111111' }),
      originA,
      ctxA,
    );
    undoA.stopCapturing();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Both users now work offline from the same base.
    applyFabricCommit(
      docB,
      annotationsB,
      makeInk('offline-ink', { left: 42, top: 4, fill: '#111111' }),
      originB,
      ctxB,
    );
    userUndo(docA, undoA, ctxA);
    assert.equal(annotationsA.has('offline-ink'), false);

    // Exchange both offline histories. B's later field ownership must make the
    // shared annotation visible again, independent of update order.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    assert.equal(annotationsA.get('offline-ink').get('fabric').get('left'), 42);
    assert.equal(annotationsB.get('offline-ink').get('fabric').get('left'), 42);
  } finally {
    disposeA();
    disposeB();
    docA.destroy();
    docB.destroy();
  }
});

test('late-sync B delete beats A offline undo-create and never resurrects', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const ctxA = {
    userId: 'offline-delete-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: docA.clientID,
  };
  const ctxB = {
    userId: 'offline-deleter',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: docB.clientID,
  };
  const {
    undoManager: undoA,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      makeInk('offline-deleted-ink', { left: 7, top: 8, fill: '#222222' }),
      originA,
      ctxA,
    );
    undoA.stopCapturing();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    applyFabricDelete(docB, annotationsB, 'offline-deleted-ink', originB);
    userUndo(docA, undoA, ctxA);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    assert.equal(annotationsA.has('offline-deleted-ink'), false);
    assert.equal(annotationsB.has('offline-deleted-ink'), false);
  } finally {
    disposeA();
    disposeB();
    docA.destroy();
    docB.destroy();
  }
});

test('three-way offline fields merge after creator undo-create in either sync order', () => {
  for (const syncOrder of ['B-then-C', 'C-then-B']) {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();
    const annotationsA = docA.getMap('annotations');
    const annotationsB = docB.getMap('annotations');
    const annotationsC = docC.getMap('annotations');
    const ctxA = {
      userId: `three-creator-${syncOrder}`,
      deviceId: 'device-a',
      sessionId: 'session-a',
      clientID: docA.clientID,
    };
    const ctxB = {
      userId: `three-left-editor-${syncOrder}`,
      deviceId: 'device-b',
      sessionId: 'session-b',
      clientID: docB.clientID,
    };
    const ctxC = {
      userId: `three-fill-editor-${syncOrder}`,
      deviceId: 'device-c',
      sessionId: 'session-c',
      clientID: docC.clientID,
    };
    const {
      undoManager: undoA,
      origin: originA,
      dispose: disposeA,
    } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
    const {
      origin: originB,
      dispose: disposeB,
    } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });
    const {
      origin: originC,
      dispose: disposeC,
    } = createUndoManager({ ydoc: docC, ...ctxC, captureTimeout: 0 });

    try {
      applyFabricCommit(
        docA,
        annotationsA,
        makeInk('three-way-ink', { left: 1, top: 2, fill: '#000000' }),
        originA,
        ctxA,
      );
      undoA.stopCapturing();
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

      applyFabricCommit(
        docB,
        annotationsB,
        makeInk('three-way-ink', { left: 42, top: 2, fill: '#000000' }),
        originB,
        ctxB,
      );
      applyFabricCommit(
        docC,
        annotationsC,
        makeInk('three-way-ink', { left: 1, top: 2, fill: '#ff0000' }),
        originC,
        ctxC,
      );
      userUndo(docA, undoA, ctxA);

      const first = syncOrder === 'B-then-C' ? docB : docC;
      const second = syncOrder === 'B-then-C' ? docC : docB;
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(first));
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(second));
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

      for (const annotations of [annotationsA, annotationsB, annotationsC]) {
        const fabric = annotations.get('three-way-ink').get('fabric');
        assert.equal(fabric.get('left'), 42, `${syncOrder}: B left must survive`);
        assert.equal(fabric.get('fill'), '#ff0000', `${syncOrder}: C fill must survive`);
      }
    } finally {
      disposeA();
      disposeB();
      disposeC();
      docA.destroy();
      docB.destroy();
      docC.destroy();
    }
  }
});

test('late C field survives A Redo or local commit after B already restored the lineage', () => {
  for (const interveningAction of ['redo', 'local-commit']) {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();
    const annotationsA = docA.getMap('annotations');
    const annotationsB = docB.getMap('annotations');
    const annotationsC = docC.getMap('annotations');
    const ctxA = {
      userId: `lineage-creator-${interveningAction}`,
      deviceId: 'device-a',
      sessionId: 'session-a',
      clientID: docA.clientID,
    };
    const ctxB = {
      userId: `lineage-left-${interveningAction}`,
      deviceId: 'device-b',
      sessionId: 'session-b',
      clientID: docB.clientID,
    };
    const ctxC = {
      userId: `lineage-fill-${interveningAction}`,
      deviceId: 'device-c',
      sessionId: 'session-c',
      clientID: docC.clientID,
    };
    const {
      undoManager: undoA,
      origin: originA,
      dispose: disposeA,
    } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
    const {
      origin: originB,
      dispose: disposeB,
    } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });
    const {
      origin: originC,
      dispose: disposeC,
    } = createUndoManager({ ydoc: docC, ...ctxC, captureTimeout: 0 });

    try {
      applyFabricCommit(
        docA,
        annotationsA,
        makeInk('lineage-ink', { left: 1, top: 2, fill: '#000000' }),
        originA,
        ctxA,
      );
      undoA.stopCapturing();
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

      applyFabricCommit(
        docB,
        annotationsB,
        makeInk('lineage-ink', { left: 42, top: 2, fill: '#000000' }),
        originB,
        ctxB,
      );
      applyFabricCommit(
        docC,
        annotationsC,
        makeInk('lineage-ink', { left: 1, top: 2, fill: '#ff0000' }),
        originC,
        ctxC,
      );
      userUndo(docA, undoA, ctxA);
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
      assert.equal(annotationsA.get('lineage-ink').get('fabric').get('left'), 42);

      if (interveningAction === 'redo') {
        userRedo(docA, undoA, ctxA);
      } else {
        applyFabricCommit(
          docA,
          annotationsA,
          makeInk('lineage-ink', { left: 42, top: 99, fill: '#000000' }),
          originA,
          ctxA,
        );
      }

      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC));
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

      for (const annotations of [annotationsA, annotationsB, annotationsC]) {
        const fabric = annotations.get('lineage-ink').get('fabric');
        assert.equal(fabric.get('left'), 42);
        assert.equal(
          fabric.get('fill'),
          '#ff0000',
          `${interveningAction}: late C fill must survive`,
        );
        if (interveningAction === 'local-commit') {
          assert.equal(fabric.get('top'), 99);
        }
      }
    } finally {
      disposeA();
      disposeB();
      disposeC();
      docA.destroy();
      docB.destroy();
      docC.destroy();
    }
  }
});

test('late explicit delete removes an annotation already restored by another offline edit', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const docC = new Y.Doc();
  const annotationsA = docA.getMap('annotations');
  const annotationsB = docB.getMap('annotations');
  const annotationsC = docC.getMap('annotations');
  const ctxA = {
    userId: 'restore-delete-creator',
    deviceId: 'device-a',
    sessionId: 'session-a',
    clientID: docA.clientID,
  };
  const ctxB = {
    userId: 'restore-delete-editor',
    deviceId: 'device-b',
    sessionId: 'session-b',
    clientID: docB.clientID,
  };
  const ctxC = {
    userId: 'restore-delete-deleter',
    deviceId: 'device-c',
    sessionId: 'session-c',
    clientID: docC.clientID,
  };
  const {
    undoManager: undoA,
    origin: originA,
    dispose: disposeA,
  } = createUndoManager({ ydoc: docA, ...ctxA, captureTimeout: 0 });
  const {
    origin: originB,
    dispose: disposeB,
  } = createUndoManager({ ydoc: docB, ...ctxB, captureTimeout: 0 });
  const {
    origin: originC,
    dispose: disposeC,
  } = createUndoManager({ ydoc: docC, ...ctxC, captureTimeout: 0 });

  try {
    applyFabricCommit(
      docA,
      annotationsA,
      makeInk('restore-delete-ink', { left: 1, top: 2, fill: '#000000' }),
      originA,
      ctxA,
    );
    undoA.stopCapturing();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

    applyFabricCommit(
      docB,
      annotationsB,
      makeInk('restore-delete-ink', { left: 42, top: 2, fill: '#000000' }),
      originB,
      ctxB,
    );
    applyFabricDelete(docC, annotationsC, 'restore-delete-ink', originC);
    userUndo(docA, undoA, ctxA);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    assert.equal(annotationsA.get('restore-delete-ink').get('fabric').get('left'), 42);

    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docC));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docC, Y.encodeStateAsUpdate(docA));

    assert.equal(annotationsA.has('restore-delete-ink'), false);
    assert.equal(annotationsB.has('restore-delete-ink'), false);
    assert.equal(annotationsC.has('restore-delete-ink'), false);
  } finally {
    disposeA();
    disposeB();
    disposeC();
    docA.destroy();
    docB.destroy();
    docC.destroy();
  }
});
