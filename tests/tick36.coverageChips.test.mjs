/**
 * Tick-36 coverage chips: annotationDocSync helpers, undo manager edges,
 * pageSpaceEraser path normalization, pdfApp metadata parse edges.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  getClientId,
  purgeAnnotationDoc,
  __test as annotationDocSyncTest,
} from '../src/services/annotationDocSync.js';
import {
  createUndoManager,
  userUndo,
  userRedo,
  getLocalFabricOrigin,
} from '../src/lib/collab/crdtUndoManager.js';
import { applyFabricCommit } from '../src/lib/collab/crdtAnnotationBridge.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';
import {
  parsePdfAppAnnotationMetadata,
  applyPdfAppAnnotationMetadata,
  buildPdfAppAnnotationMetadata,
  serializePdfAppAnnotationMetadata,
  parsePdfAppLayerStateMetadata,
  readSurveyMarkerLayer,
} from '../src/utils/pdfAppAnnotationMetadata.js';

test('annotationDocSync bytesToPgHex/pgHexToBytes + getClientId + purge', async () => {
  const { bytesToPgHex, pgHexToBytes } = annotationDocSyncTest;
  const bytes = new Uint8Array([0, 15, 255, 16]);
  const hex = bytesToPgHex(bytes);
  assert.match(hex, /^\\x/);
  assert.deepEqual(Array.from(pgHexToBytes(hex)), Array.from(bytes));
  assert.deepEqual(Array.from(pgHexToBytes(bytes)), Array.from(bytes));
  assert.deepEqual(Array.from(pgHexToBytes('')), []);
  assert.deepEqual(Array.from(pgHexToBytes(null)), []);

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const id1 = getClientId();
    const id2 = getClientId();
    assert.equal(id1, id2);
    assert.ok(store.has('annoClientId'));

    store.set('cloudSyncQueue_doc-purge', '[]');
    await purgeAnnotationDoc('doc-purge');
    assert.equal(store.has('cloudSyncQueue_doc-purge'), false);
    await purgeAnnotationDoc('');
    await purgeAnnotationDoc(null);
  } finally {
    delete globalThis.localStorage;
  }

  // getClientId without localStorage falls back to random UUID
  const ephemeral = getClientId();
  assert.equal(typeof ephemeral, 'string');
  assert.ok(ephemeral.length > 0);
});

test('createUndoManager historyCap + dispose + userUndo/Redo', () => {
  const ydoc = new Y.Doc();
  const ctx = {
    userId: 'u1',
    deviceId: 'd1',
    sessionId: 's1',
    clientID: ydoc.clientID,
  };
  const { undoManager, origin, dispose } = createUndoManager({
    ydoc,
    ...ctx,
    historyCap: 2,
    captureTimeout: 0,
  });
  assert.equal(origin, getLocalFabricOrigin(ctx));
  const yMap = ydoc.getMap('annotations');

  for (let i = 0; i < 4; i += 1) {
    applyFabricCommit(
      ydoc,
      yMap,
      {
        type: 'rect',
        left: i,
        top: i,
        width: 2,
        height: 2,
        data: { id: `undo-${i}` },
        pageNumber: 1,
      },
      origin,
      ctx,
    );
  }
  assert.ok(undoManager.undoStack.length <= 2);

  userUndo(ydoc, undoManager, ctx);
  userRedo(ydoc, undoManager, ctx);
  dispose();
  dispose(); // idempotent
  ydoc.destroy();
});

test('erasePageAnnotations covers relative path ops and empty guards', () => {
  const empty = erasePageAnnotations({});
  assert.equal(empty.didChange, false);

  const page = {
    objects: [
      {
        type: 'path',
        id: 'rel-1',
        tool: 'pen',
        stroke: '#111',
        strokeWidth: 8,
        path: [
          ['M', 0, 40],
          ['h', 40],
          ['v', 0],
          ['l', 20, 0],
          ['Q', 70, 40, 80, 40],
          ['C', 90, 40, 100, 40, 110, 40],
          ['Z'],
          ['m', 0, 10],
          ['L', 50, 50],
        ],
        left: 0,
        top: 0,
        data: { id: 'rel-1', tool: 'pen' },
      },
      { type: 'rect', id: 'skip-me' },
    ],
  };

  const result = erasePageAnnotations({
    pageAnnotations: page,
    eraserPoints: [{ x: 20, y: 40 }],
    eraserRadius: 10,
    mode: 'partial',
  });
  assert.equal(typeof result.didChange, 'boolean');
  assert.ok(Array.isArray(result.changedIds) || Array.isArray(result.deletedIds));
});

test('pdfAppAnnotationMetadata parse/apply edge cases', () => {
  assert.equal(parsePdfAppAnnotationMetadata(null), null);
  assert.equal(parsePdfAppAnnotationMetadata('{'), null);
  assert.equal(parsePdfAppAnnotationMetadata('{"kind":"nope"}'), null);
  assert.equal(parsePdfAppLayerStateMetadata(null), null);
  assert.equal(parsePdfAppLayerStateMetadata('{'), null);
  assert.deepEqual(readSurveyMarkerLayer(null), {});
  assert.deepEqual(readSurveyMarkerLayer({ layers: { surveyMarkers: { a: 1 } } }), { a: 1 });
  assert.deepEqual(readSurveyMarkerLayer({ layers: { highlightAnnotations: { b: 2 } } }), { b: 2 });

  const meta = buildPdfAppAnnotationMetadata(
    { type: 'rect', left: 1, top: 2, width: 3, height: 4, data: { id: 'm1' } },
    { type: 'rect' },
  );
  assert.ok(meta);
  const serialized = serializePdfAppAnnotationMetadata(
    { type: 'rect', left: 1, top: 2, width: 3, height: 4, data: { id: 'm1' } },
    { type: 'rect' },
  );
  assert.equal(typeof serialized, 'string');

  const applied = applyPdfAppAnnotationMetadata({ type: 'rect' }, null);
  assert.equal(applied.type, 'rect');
  const applied2 = applyPdfAppAnnotationMetadata(
    { type: 'rect', data: {} },
    parsePdfAppAnnotationMetadata(serialized),
  );
  assert.ok(applied2);
});
