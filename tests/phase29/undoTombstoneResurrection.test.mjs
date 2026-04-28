// tests/phase29/undoTombstoneResurrection.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until BOTH Plan 29-02
// (crdtAnnotationBridge.js) AND Plan 29-03 (crdtUndoManager.js) land.
//
// Validates UNDO-03: undo of DELETE restores the annotation with its full meta
// intact (authorId, deviceId, createdAt unchanged from the original CREATE — even
// when the deleter and the original creator are different users).

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Two TARGETs — both must exist before the test can run. The TARGET label is
// kept for downstream tooling (Plan 29-01 acceptance grep `grep -l TARGET`).
const TARGET = path.resolve(__dirname, '../../src/lib/collab/crdtAnnotationBridge.js');
const BRIDGE = TARGET; // alias for readability inside the test body
const UNDO_MGR = path.resolve(__dirname, '../../src/lib/collab/crdtUndoManager.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const YJS_INSTALLED = existsSync(path.resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

function skipReason() {
  if (!existsSync(BRIDGE)) return 'crdtAnnotationBridge.js not yet present (Plan 29-02)';
  if (!existsSync(UNDO_MGR)) return 'crdtUndoManager.js not yet present (Plan 29-03)';
  if (!YJS_INSTALLED) return 'yjs not installed yet';
  return false;
}

test(
  'UNDO-03 #1: CREATE → DELETE → undo — annoId restored with original meta exactly',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit, applyFabricDelete } = await import(BRIDGE);
    const { createUndoManager } = await import(UNDO_MGR);

    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctxA = { userId: 'userA', deviceId: 'devA', sessionId: 'sA', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctxA });

    applyFabricCommit(ydoc, yMap, {
      left: 10, top: 20, fill: '#abc', data: { id: 'annoX' },
      toObject: () => ({ left: 10, top: 20, fill: '#abc' }),
    }, origin, ctxA);
    const meta0 = yMap.get('annoX').get('meta');
    const authorId0 = meta0.get('authorId');
    const deviceId0 = meta0.get('deviceId');
    const createdAt0 = meta0.get('createdAt');

    applyFabricDelete(ydoc, yMap, 'annoX', origin);
    strictEqual(yMap.has('annoX'), false, 'DELETE removed annoX');

    undoManager.undo();
    strictEqual(yMap.has('annoX'), true, 'undo resurrected annoX');
    const metaAfter = yMap.get('annoX').get('meta');
    strictEqual(metaAfter.get('authorId'), authorId0, 'restored meta.authorId === original CREATE');
    strictEqual(metaAfter.get('deviceId'), deviceId0, 'restored meta.deviceId === original CREATE');
    strictEqual(metaAfter.get('createdAt'), createdAt0, 'restored meta.createdAt === original CREATE');
  },
);

test(
  'UNDO-03 #2: CREATE → EDIT → DELETE → undo — restored value is post-EDIT state with original CREATE meta',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit, applyFabricDelete } = await import(BRIDGE);
    const { createUndoManager } = await import(UNDO_MGR);

    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctxA = { userId: 'userA', deviceId: 'devA', sessionId: 'sA', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctxA });

    applyFabricCommit(ydoc, yMap, {
      left: 0, fill: '#000', data: { id: 'annoX' },
      toObject: () => ({ left: 0, fill: '#000' }),
    }, origin, ctxA);
    const createdAt0 = yMap.get('annoX').get('meta').get('createdAt');

    applyFabricCommit(ydoc, yMap, {
      left: 100, fill: '#fff', data: { id: 'annoX' },
      toObject: () => ({ left: 100, fill: '#fff' }),
    }, origin, ctxA);

    applyFabricDelete(ydoc, yMap, 'annoX', origin);
    undoManager.undo(); // undoes DELETE
    const fab = yMap.get('annoX').get('fabric');
    strictEqual(fab.get('left'), 100, 'restored value === post-EDIT state');
    strictEqual(fab.get('fill'), '#fff', 'restored value === post-EDIT state');
    strictEqual(yMap.get('annoX').get('meta').get('createdAt'), createdAt0, 'meta.createdAt unchanged across CREATE→EDIT→DELETE→undo');
  },
);
