// tests/phase29/concurrentDifferentAnnos.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-02 lands
// src/lib/collab/crdtAnnotationBridge.js. Pattern lifted from Phase 28 scaffolds.
//
// Validates COLLAB-02: two clients edit different annotations on the same page,
// both edits land cleanly via Y.encodeStateAsUpdate ↔ Y.applyUpdate sync.

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
  'COLLAB-02 #1: Doc A edits annoA + Doc B edits annoB — sync produces both annos on both docs',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit } = await import(TARGET);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const yMapA = docA.getMap('annotations');
    const yMapB = docB.getMap('annotations');

    const originA = Object.freeze({ source: 'local-fabric', userId: 'uA', deviceId: 'dA', sessionId: 'sA', clientID: docA.clientID });
    const originB = Object.freeze({ source: 'local-fabric', userId: 'uB', deviceId: 'dB', sessionId: 'sB', clientID: docB.clientID });

    applyFabricCommit(docA, yMapA, {
      left: 100, top: 100, fill: '#ff0000', data: { id: 'annoA' },
      toObject: () => ({ left: 100, top: 100, fill: '#ff0000' }),
    }, originA, { userId: 'uA', deviceId: 'dA' });

    applyFabricCommit(docB, yMapB, {
      left: 200, top: 200, fill: '#00ff00', data: { id: 'annoB' },
      toObject: () => ({ left: 200, top: 200, fill: '#00ff00' }),
    }, originB, { userId: 'uB', deviceId: 'dB' });

    // Sync both directions.
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    ok(yMapA.has('annoA'), 'docA must still have annoA after sync');
    ok(yMapA.has('annoB'), 'docA must have docB-originated annoB after sync');
    ok(yMapB.has('annoA'), 'docB must have docA-originated annoA after sync');
    ok(yMapB.has('annoB'), 'docB must still have annoB after sync');
  },
);

test(
  'COLLAB-02 #2: concurrent transact windows on different annos do not produce property collision',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit } = await import(TARGET);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const yMapA = docA.getMap('annotations');
    const yMapB = docB.getMap('annotations');

    const originA = Object.freeze({ source: 'local-fabric', userId: 'uA', deviceId: 'dA', sessionId: 'sA', clientID: docA.clientID });
    const originB = Object.freeze({ source: 'local-fabric', userId: 'uB', deviceId: 'dB', sessionId: 'sB', clientID: docB.clientID });

    // Both within the same logical "window" (no syncs between).
    applyFabricCommit(docA, yMapA, {
      left: 50, fill: '#aaa', data: { id: 'annoA' },
      toObject: () => ({ left: 50, fill: '#aaa' }),
    }, originA, { userId: 'uA', deviceId: 'dA' });
    applyFabricCommit(docB, yMapB, {
      left: 60, fill: '#bbb', data: { id: 'annoB' },
      toObject: () => ({ left: 60, fill: '#bbb' }),
    }, originB, { userId: 'uB', deviceId: 'dB' });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // No collision means both annos exist with both fills intact.
    const fabA = yMapA.get('annoA')?.get('fabric');
    const fabB = yMapA.get('annoB')?.get('fabric');
    ok(fabA, 'annoA fabric subdoc on docA must exist');
    ok(fabB, 'annoB fabric subdoc on docA must exist');
    strictEqual(fabA.get('fill'), '#aaa');
    strictEqual(fabB.get('fill'), '#bbb');
  },
);

test(
  'COLLAB-02 #3: from-empty sync — Doc B starts empty, receives Doc A update with two annotations on same page',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit } = await import(TARGET);

    const docA = new Y.Doc();
    const yMapA = docA.getMap('annotations');
    const originA = Object.freeze({ source: 'local-fabric', userId: 'uA', deviceId: 'dA', sessionId: 'sA', clientID: docA.clientID });

    applyFabricCommit(docA, yMapA, {
      left: 10, top: 10, page: 1, data: { id: 'annoA' },
      toObject: () => ({ left: 10, top: 10, page: 1 }),
    }, originA, { userId: 'uA', deviceId: 'dA' });
    applyFabricCommit(docA, yMapA, {
      left: 30, top: 30, page: 1, data: { id: 'annoB' },
      toObject: () => ({ left: 30, top: 30, page: 1 }),
    }, originA, { userId: 'uA', deviceId: 'dA' });

    const docB = new Y.Doc(); // empty
    const yMapB = docB.getMap('annotations');
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    ok(yMapB.has('annoA'), 'from-empty sync must materialize annoA on docB');
    ok(yMapB.has('annoB'), 'from-empty sync must materialize annoB on docB');
    strictEqual(yMapB.get('annoA').get('fabric').get('left'), 10);
    strictEqual(yMapB.get('annoB').get('fabric').get('left'), 30);
  },
);
