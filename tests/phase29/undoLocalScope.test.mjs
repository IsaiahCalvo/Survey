// tests/phase29/undoLocalScope.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-03 lands
// src/lib/collab/crdtUndoManager.js.
//
// Validates UNDO-01: a local user's Cmd+Z reverses their own most recent action.
// Three load-bearing primitives are under test:
//   1. getLocalFabricOrigin memoizes the origin payload (reference equality across
//      repeated calls with the same userId/deviceId/sessionId/clientID).
//   2. createUndoManager wires that memoized origin into Y.UndoManager.trackedOrigins.
//   3. After ydoc.transact(fn, origin), undoManager.canUndo() / .undo() works.
//
// trackedOrigins reference equality is THE invariant — Pitfall 7 lives or dies on it.

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
  'UNDO-01 #1: getLocalFabricOrigin memoizes — two calls with same payload return === same reference',
  { skip: skipReason() },
  async () => {
    const { getLocalFabricOrigin } = await import(TARGET);
    const a = getLocalFabricOrigin({ userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    const b = getLocalFabricOrigin({ userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    strictEqual(a, b, 'getLocalFabricOrigin must memoize — same payload → same reference');
    strictEqual(a.source, 'local-fabric', 'origin source must be "local-fabric" (distinct from "local" used by transport-layer origins)');
    ok(Object.isFrozen(a), 'origin must be Object.frozen');
  },
);

test(
  'UNDO-01 #2: createUndoManager wires trackedOrigins with the memoized origin reference',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { getLocalFabricOrigin, createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx });
    const memoized = getLocalFabricOrigin(ctx);
    strictEqual(origin, memoized, 'origin returned from createUndoManager must equal getLocalFabricOrigin output');
    ok(undoManager.trackedOrigins.has(origin), 'undoManager.trackedOrigins must contain the memoized origin reference');
  },
);

test(
  'UNDO-01 #3: ydoc.transact(fn, origin) registers an undo step; undoManager.undo() reverses it',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { createUndoManager } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const ctx = { userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: ydoc.clientID };
    const { undoManager, origin } = createUndoManager({ ydoc, ...ctx });

    ydoc.transact(() => {
      const sub = new Y.Map();
      sub.set('left', 100);
      yMap.set('annoX', sub);
    }, origin);

    ok(undoManager.canUndo(), 'after transact under tracked origin, canUndo() must be true');
    undoManager.undo();
    strictEqual(yMap.has('annoX'), false, 'undo() must remove the annoX entry created in the transact');
  },
);
