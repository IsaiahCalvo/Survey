// tests/phase29/eraserSwipeUndo.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until BOTH Plan 29-02
// (crdtAnnotationBridge.js) AND Plan 29-03 (crdtUndoManager.js) land.
//
// Validates the one-press eraser-swipe undo: a single eraser swipe wiping 5 strokes
// must restore all 5 in ONE Cmd+Z. Implementation primitive is to wrap the 5 deletes
// in a single ydoc.transact() — Y.UndoManager treats one transact = one undo step.

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
  'eraser-swipe #1: 5 deletes wrapped in ONE transact — single undo restores all 5',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit, applyFabricDelete } = await import(BRIDGE);
    const { createUndoManager } = await import(UNDO_MGR);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx });

    // Seed 5 strokes.
    for (let i = 0; i < 5; i++) {
      applyFabricCommit(ydoc, yMap, {
        left: i, top: i, data: { id: `stroke${i}` },
        toObject: () => ({ left: i, top: i }),
      }, origin, ctx);
    }
    undoManager.stopCapturing(); // boundary so the 5 CREATEs aren't collapsed with the wipe

    // Eraser session: ONE transact, 5 deletes.
    ydoc.transact(() => {
      for (let i = 0; i < 5; i++) {
        applyFabricDelete(ydoc, yMap, `stroke${i}`, origin);
      }
    }, origin);
    for (let i = 0; i < 5; i++) strictEqual(yMap.has(`stroke${i}`), false, `wipe removed stroke${i}`);

    undoManager.undo();
    for (let i = 0; i < 5; i++) {
      ok(yMap.has(`stroke${i}`), `single undo restored stroke${i} (one transact = one undo step)`);
    }
  },
);

test(
  'eraser-swipe #2: control case — 5 deletes in 5 SEPARATE transacts → single undo restores only one',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit, applyFabricDelete } = await import(BRIDGE);
    const { createUndoManager } = await import(UNDO_MGR);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx, captureTimeout: 0 });

    for (let i = 0; i < 5; i++) {
      applyFabricCommit(ydoc, yMap, {
        left: i, top: i, data: { id: `stroke${i}` },
        toObject: () => ({ left: i, top: i }),
      }, origin, ctx);
      undoManager.stopCapturing();
    }

    // 5 SEPARATE transacts (no wrap) — each is its own undo step.
    for (let i = 0; i < 5; i++) {
      applyFabricDelete(ydoc, yMap, `stroke${i}`, origin);
      undoManager.stopCapturing();
    }

    undoManager.undo();
    // Only the LAST delete is reversed — strokes 0-3 remain wiped.
    strictEqual(yMap.has('stroke4'), true, 'last delete reversed');
    strictEqual(yMap.has('stroke0'), false, 'earlier deletes still wiped — control case demonstrates wrap is required');
  },
);
