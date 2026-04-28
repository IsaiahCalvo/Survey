// tests/phase29/resurrectRace.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until BOTH Plan 29-02
// (crdtAnnotationBridge.js) AND Plan 29-03 (crdtUndoManager.js) land.
//
// Tests the resurrect-race scenario from 29-CONTEXT.md:
//   • Doc A has annoX
//   • Doc B sets X.fabric.fill='#ff0000'
//   • Doc A deletes X via applyFabricDelete BEFORE syncing B's edit
//   • After sync (in either order), A.undoManager.undo() must restore X with
//     B's fill='#ff0000' AND meta.authorId/createdAt at original values.
//
// The race tests Yjs CRDT semantics: undo is a logical operation that produces
// the inverse Y.Doc transaction; on resync, B's fill survives because Y.Map
// LWW per-key resolves the conflict deterministically.

import { test } from 'node:test';
import { strictEqual } from 'node:assert/strict';
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
  'resurrect race: A deletes; B edits in parallel; sync; A.undo restores X with B fill + original meta',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit, applyFabricDelete } = await import(BRIDGE);
    const { createUndoManager } = await import(UNDO_MGR);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const yMapA = docA.getMap('annotations');
    const yMapB = docB.getMap('annotations');

    const ctxA = { userId: 'userA', deviceId: 'devA', sessionId: 'sA', clientID: docA.clientID };
    const ctxB = { userId: 'userB', deviceId: 'devB', sessionId: 'sB', clientID: docB.clientID };
    const { undoManager: umA, origin: oA } = createUndoManager({ ydoc: docA, ...ctxA });
    const { origin: oB } = createUndoManager({ ydoc: docB, ...ctxB });

    // SEED: A creates X; sync to B.
    applyFabricCommit(docA, yMapA, {
      left: 0, top: 0, fill: '#000', data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0, fill: '#000' }),
    }, oA, ctxA);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const createdAt0 = yMapA.get('annoX').get('meta').get('createdAt');

    // RACE: B edits, A deletes — concurrent, no sync between.
    applyFabricCommit(docB, yMapB, {
      left: 0, top: 0, fill: '#ff0000', data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0, fill: '#ff0000' }),
    }, oB, ctxB);
    applyFabricDelete(docA, yMapA, 'annoX', oA);

    // SYNC after race: both directions.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // A's undo of the DELETE — restore expected to surface B's edit and original meta.
    umA.undo();

    // Final state: annoX present with fill='#ff0000' and original meta.
    const fab = yMapA.get('annoX').get('fabric');
    strictEqual(fab.get('fill'), '#ff0000', 'undo of delete must surface B-edited fill (Y.Map LWW per-key)');
    const meta = yMapA.get('annoX').get('meta');
    strictEqual(meta.get('authorId'), 'userA', 'meta.authorId preserved as original creator across resurrect race');
    strictEqual(meta.get('createdAt'), createdAt0, 'meta.createdAt preserved across resurrect race');
  },
);
