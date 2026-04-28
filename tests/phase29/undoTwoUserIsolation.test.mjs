// tests/phase29/undoTwoUserIsolation.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-03 lands
// src/lib/collab/crdtUndoManager.js.
//
// CANONICAL Pitfall 7 test: per-user undo never reverses collaborator work.
//
// Two users each have their own UndoManager constructed with their own memoized
// origin. trackedOrigins is per-manager; so A.undo() can only reverse transactions
// tagged with origin_A. trackedOrigins reference equality is the linchpin —
// rebuilding the origin object instead of memoizing breaks isolation silently.

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
  'UNDO-02 #1: A.undo() reverses A only; B-tagged transact untouched',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');

    const ctxA = { userId: 'userA', deviceId: 'devA', sessionId: 'sA', clientID: ydoc.clientID };
    const ctxB = { userId: 'userB', deviceId: 'devB', sessionId: 'sB', clientID: ydoc.clientID };
    const { undoManager: umA, origin: oA } = createUndoManager({ ydoc, ...ctxA });
    const { undoManager: umB, origin: oB } = createUndoManager({ ydoc, ...ctxB });

    ydoc.transact(() => {
      const m = new Y.Map(); m.set('owner', 'A'); yMap.set('annoA', m);
    }, oA);
    ydoc.transact(() => {
      const m = new Y.Map(); m.set('owner', 'B'); yMap.set('annoB', m);
    }, oB);

    // trackedOrigins is per-manager; A's undo should never touch B's entry.
    umA.undo();
    strictEqual(yMap.has('annoA'), false, 'A.undo must remove annoA');
    strictEqual(yMap.has('annoB'), true, 'A.undo must NOT touch annoB (CANONICAL Pitfall 7)');
    strictEqual(yMap.get('annoB').get('owner'), 'B', 'B-tagged data preserved through A.undo');
    // sanity: B can still undo its own.
    ok(umB.canUndo(), 'B can still undo its own work');
  },
);

test(
  'UNDO-02 #2: cross-user no-op — A.canUndo() is false when only B has transacted',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctxA = { userId: 'userA', deviceId: 'devA', sessionId: 'sA', clientID: ydoc.clientID };
    const ctxB = { userId: 'userB', deviceId: 'devB', sessionId: 'sB', clientID: ydoc.clientID };
    const { undoManager: umA } = createUndoManager({ ydoc, ...ctxA });
    const { origin: oB } = createUndoManager({ ydoc, ...ctxB });

    ydoc.transact(() => {
      const m = new Y.Map(); m.set('owner', 'B'); yMap.set('annoB', m);
    }, oB);

    strictEqual(umA.canUndo(), false, 'A.canUndo must be false when only B-tagged transacts exist (cross-user no-op)');
  },
);

test(
  'UNDO-02 #3: trackedOrigins reference-drift detection — freshly-frozen object NOT from getLocalFabricOrigin returns false',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { getLocalFabricOrigin, createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const memoized = getLocalFabricOrigin(ctx);
    const { undoManager } = createUndoManager({ ydoc, ...ctx });

    // Memoized origin: should be in trackedOrigins.
    ok(undoManager.trackedOrigins.has(memoized), 'memoized origin must be trackedOrigins.has === true');

    // Hand-rolled object with same shape but different identity: must NOT be tracked.
    // This is the canonical reference-drift bug Pitfall 7 calls out.
    const handRolled = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID });
    strictEqual(undoManager.trackedOrigins.has(handRolled), false, 'reference-drift origin must NOT match trackedOrigins');
  },
);
