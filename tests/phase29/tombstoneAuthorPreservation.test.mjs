// tests/phase29/tombstoneAuthorPreservation.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-02 lands
// src/lib/collab/crdtAnnotationBridge.js.
//
// Validates UNDO-03 detail: meta.authorId / meta.deviceId / meta.createdAt are
// write-once on CREATE and survive every subsequent EDIT regardless of the
// editing user — the "tombstone" of the original creator never decays.
//
// Companion: undoTombstoneResurrection.test.mjs (which adds the DELETE → undo
// resurrection pathway). This file exercises the simpler CREATE → EDIT case.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/crdtAnnotationBridge.js');
const REPO_ROOT = path.resolve(__dirname, '../..');
const YJS_INSTALLED = existsSync(path.resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

function skipReason() {
  if (!existsSync(TARGET)) return 'crdtAnnotationBridge.js not yet present (Plan 29-02)';
  if (!YJS_INSTALLED) return 'yjs not installed yet';
  return false;
}

test(
  'UNDO-03 #1: CREATE writes meta.authorId, meta.deviceId, meta.createdAt from ctx',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const origin = Object.freeze({ source: 'local-fabric', userId: 'userA', deviceId: 'devA', sessionId: 's1', clientID: ydoc.clientID });
    applyFabricCommit(ydoc, yMap, {
      left: 0, top: 0, data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0 }),
    }, origin, { userId: 'userA', deviceId: 'devA' });
    const meta = yMap.get('annoX').get('meta');
    strictEqual(meta.get('authorId'), 'userA', 'CREATE: meta.authorId = ctx.userId');
    strictEqual(meta.get('deviceId'), 'devA', 'CREATE: meta.deviceId = ctx.deviceId');
    ok(meta.get('createdAt') != null, 'CREATE: meta.createdAt populated');
  },
);

test(
  'UNDO-03 #2: EDIT under different ctx (userB/devB) preserves meta.authorId/deviceId/createdAt; updates lastEditorId/updatedAt',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMap = ydoc.getMap('annotations');
    const originA = Object.freeze({ source: 'local-fabric', userId: 'userA', deviceId: 'devA', sessionId: 's1', clientID: ydoc.clientID });
    const originB = Object.freeze({ source: 'local-fabric', userId: 'userB', deviceId: 'devB', sessionId: 's2', clientID: ydoc.clientID });

    applyFabricCommit(ydoc, yMap, {
      left: 0, top: 0, data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0 }),
    }, originA, { userId: 'userA', deviceId: 'devA' });
    const createdAt0 = yMap.get('annoX').get('meta').get('createdAt');

    await new Promise((r) => setTimeout(r, 2));
    applyFabricCommit(ydoc, yMap, {
      left: 99, top: 0, data: { id: 'annoX' },
      toObject: () => ({ left: 99, top: 0 }),
    }, originB, { userId: 'userB', deviceId: 'devB' });

    const meta = yMap.get('annoX').get('meta');
    strictEqual(meta.get('authorId'), 'userA', 'EDIT must preserve meta.authorId (write-once)');
    strictEqual(meta.get('deviceId'), 'devA', 'EDIT must preserve meta.deviceId (write-once)');
    strictEqual(meta.get('createdAt'), createdAt0, 'EDIT must preserve meta.createdAt (write-once)');
    strictEqual(meta.get('lastEditorId'), 'userB', 'EDIT updates meta.lastEditorId');
    ok(meta.get('updatedAt') >= createdAt0, 'EDIT updates meta.updatedAt');
  },
);
