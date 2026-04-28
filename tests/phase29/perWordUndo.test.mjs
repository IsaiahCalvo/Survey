// tests/phase29/perWordUndo.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-03 lands
// src/lib/collab/crdtUndoManager.js.
//
// Validates per-word undo for text annotations: Cmd+Z reverts to the previous
// whitespace boundary, not whole text or per-keystroke. The boundary primitive is
// Y.UndoManager.captureTimeout for time-based grouping plus undoManager.stopCapturing()
// for explicit boundary breaks (which Plan 29-05 fires on whitespace text:changed events).

import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert/strict';
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
  'per-word undo #1: multiple transacts within captureTimeout collapse into one undo step',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    // captureTimeout=500ms (Plan 29-03 default) — three transacts within 100ms must collapse.
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx, captureTimeout: 500 });

    ydoc.transact(() => {
      const m = new Y.Map(); m.set('text', 'h'); yMap.set('annoT', m);
    }, origin);
    ydoc.transact(() => {
      yMap.get('annoT').set('text', 'he');
    }, origin);
    ydoc.transact(() => {
      yMap.get('annoT').set('text', 'hel');
    }, origin);

    // One undo should revert all three (single undo step inside captureTimeout window).
    undoManager.undo();
    strictEqual(yMap.has('annoT'), false, 'single undo collapsed three within-window transacts');
  },
);

test(
  'per-word undo #2: stopCapturing() between two transacts produces TWO undo steps (whitespace boundary primitive)',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx, captureTimeout: 5000 }); // wide window

    ydoc.transact(() => {
      const m = new Y.Map(); m.set('text', 'hello'); yMap.set('annoT', m);
    }, origin);
    undoManager.stopCapturing(); // explicit boundary (whitespace fired this from Plan 29-05)
    ydoc.transact(() => {
      yMap.get('annoT').set('text', 'hello world');
    }, origin);

    // First undo reverts only the second transact.
    undoManager.undo();
    strictEqual(yMap.get('annoT').get('text'), 'hello', 'first undo reverts the post-boundary transact');
    ok(undoManager.canUndo(), 'a second undo step exists');
    undoManager.undo();
    strictEqual(yMap.has('annoT'), false, 'second undo reverts the pre-boundary transact');
  },
);
