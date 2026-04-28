// tests/phase29/redoLocalScope.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-03 lands
// src/lib/collab/crdtUndoManager.js.
//
// Validates UNDO-04: Cmd+Shift+Z redoes the local user's most recently undone
// action. The redo direction mirrors the undo direction — same trackedOrigins
// scoping rules apply (A.redo cannot resurrect B's edits, and vice versa).

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/crdtUndoManager.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const YJS_INSTALLED = existsSync(path.resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

function skipReason() {
  if (!existsSync(TARGET)) return 'crdtUndoManager.js not yet present (Plan 29-03)';
  if (!YJS_INSTALLED) return 'yjs not installed yet';
  return false;
}

test(
  'UNDO-04 #1: undo → canRedo === true; userRedo reapplies the undone change',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager, userRedo } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx });

    ydoc.transact(() => {
      const m = new Y.Map(); m.set('left', 50); yMap.set('annoX', m);
    }, origin);

    undoManager.undo();
    strictEqual(yMap.has('annoX'), false, 'undo removed annoX');
    ok(undoManager.canRedo(), 'after undo, canRedo === true');

    userRedo(ydoc, undoManager, ctx);
    strictEqual(yMap.has('annoX'), true, 'redo restored annoX');
    strictEqual(yMap.get('annoX').get('left'), 50, 'redo restored full property state');
  },
);

test(
  'UNDO-04 #2: redo isolation — A.redo does NOT resurrect B-tagged changes',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const { undoManager: umA, origin: oA } = createUndoManager({ ydoc, userId: 'A', deviceId: 'dA', sessionId: 'sA', clientID: ydoc.clientID });
    const { undoManager: umB, origin: oB } = createUndoManager({ ydoc, userId: 'B', deviceId: 'dB', sessionId: 'sB', clientID: ydoc.clientID });

    ydoc.transact(() => {
      const m = new Y.Map(); m.set('owner', 'A'); yMap.set('annoA', m);
    }, oA);
    ydoc.transact(() => {
      const m = new Y.Map(); m.set('owner', 'B'); yMap.set('annoB', m);
    }, oB);

    umA.undo(); // remove A
    umB.undo(); // remove B
    strictEqual(yMap.has('annoA'), false);
    strictEqual(yMap.has('annoB'), false);

    umA.redo(); // restore A only
    strictEqual(yMap.has('annoA'), true, 'A.redo restored A');
    strictEqual(yMap.has('annoB'), false, 'A.redo must NOT resurrect B (cross-user redo isolation)');
  },
);
