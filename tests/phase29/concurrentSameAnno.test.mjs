// tests/phase29/concurrentSameAnno.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-02 lands
// src/lib/collab/crdtAnnotationBridge.js.
//
// Validates COLLAB-03: per-property LWW via Y.Map nested keys. Two users editing
// different properties of the SAME annotation must both survive sync (Y.Map per-key
// merge). Two users editing the SAME property — one wins via Yjs internal logical
// clock (NOT via meta.updatedAt; that is a human-display field only).
//
// Also validates the meta.authorId / meta.deviceId / meta.createdAt write-once
// invariant (set on CREATE, never overwritten on subsequent EDIT — meta.updatedAt
// and meta.lastEditorId update every commit).

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
  'COLLAB-03 #1: per-property merge — A sets fill, B sets left on same anno; both survive sync (Y.Map per-key)',
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

    // Seed annoX on both via initial sync.
    applyFabricCommit(docA, yMapA, {
      left: 0, top: 0, fill: '#000', data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0, fill: '#000' }),
    }, originA, { userId: 'uA', deviceId: 'dA' });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Concurrent: A changes fill, B changes left.
    applyFabricCommit(docA, yMapA, {
      left: 0, top: 0, fill: '#ff0000', data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0, fill: '#ff0000' }),
    }, originA, { userId: 'uA', deviceId: 'dA' });
    applyFabricCommit(docB, yMapB, {
      left: 100, top: 0, fill: '#000', data: { id: 'annoX' },
      toObject: () => ({ left: 100, top: 0, fill: '#000' }),
    }, originB, { userId: 'uB', deviceId: 'dB' });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // Both per-key writes survive: fill='#ff0000' (A) AND left=100 (B).
    const fabA = yMapA.get('annoX').get('fabric');
    strictEqual(fabA.get('fill'), '#ff0000', 'A-set fill must survive per-key merge');
    strictEqual(fabA.get('left'), 100, 'B-set left must survive per-key merge');
  },
);

test(
  'COLLAB-03 #2: same-key conflict — Yjs logical clock picks one winner (NOT meta.updatedAt)',
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
      fill: '#ff0000', data: { id: 'annoX' },
      toObject: () => ({ fill: '#ff0000' }),
    }, originA, { userId: 'uA', deviceId: 'dA' });
    applyFabricCommit(docB, yMapB, {
      fill: '#0000ff', data: { id: 'annoX' },
      toObject: () => ({ fill: '#0000ff' }),
    }, originB, { userId: 'uB', deviceId: 'dB' });

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    // Both docs converge to ONE of the two fills — Yjs logical clock decides
    // (deterministic; both sides see the same winner). meta.updatedAt is
    // human-display only and must NOT influence convergence.
    const winnerA = yMapA.get('annoX').get('fabric').get('fill');
    const winnerB = yMapB.get('annoX').get('fabric').get('fill');
    strictEqual(winnerA, winnerB, 'both docs must converge to the same fill (Yjs LWW per-key)');
    ok(['#ff0000', '#0000ff'].includes(winnerA), 'winner must be one of the two committed fills');
  },
);

test(
  'COLLAB-03 #3: meta.authorId / meta.deviceId / meta.createdAt are write-once; meta.updatedAt + meta.lastEditorId update every commit',
  { skip: skipReason() },
  async () => {
    const Y = await import('yjs');
    const { applyFabricCommit } = await import(TARGET);

    const docA = new Y.Doc();
    const yMapA = docA.getMap('annotations');
    const originA = Object.freeze({ source: 'local-fabric', userId: 'uA', deviceId: 'dA', sessionId: 'sA', clientID: docA.clientID });
    const originB = Object.freeze({ source: 'local-fabric', userId: 'uB', deviceId: 'dB', sessionId: 'sB', clientID: docA.clientID });

    // CREATE under userA / deviceA.
    applyFabricCommit(docA, yMapA, {
      left: 0, top: 0, data: { id: 'annoX' },
      toObject: () => ({ left: 0, top: 0 }),
    }, originA, { userId: 'uA', deviceId: 'dA' });

    const meta1 = yMapA.get('annoX').get('meta');
    const authorId1 = meta1.get('authorId');
    const deviceId1 = meta1.get('deviceId');
    const createdAt1 = meta1.get('createdAt');
    strictEqual(authorId1, 'uA', 'CREATE: meta.authorId set to creator userId');
    strictEqual(deviceId1, 'dA', 'CREATE: meta.deviceId set to creator deviceId');
    ok(typeof createdAt1 === 'number' || typeof createdAt1 === 'string', 'CREATE: meta.createdAt set');

    // EDIT under userB / deviceB on the SAME annoId.
    await new Promise((r) => setTimeout(r, 2)); // ensure updatedAt strictly increases
    applyFabricCommit(docA, yMapA, {
      left: 100, top: 0, data: { id: 'annoX' },
      toObject: () => ({ left: 100, top: 0 }),
    }, originB, { userId: 'uB', deviceId: 'dB' });

    const meta2 = yMapA.get('annoX').get('meta');
    strictEqual(meta2.get('authorId'), 'uA', 'EDIT must NOT overwrite meta.authorId (write-once)');
    strictEqual(meta2.get('deviceId'), 'dA', 'EDIT must NOT overwrite meta.deviceId (write-once)');
    strictEqual(meta2.get('createdAt'), createdAt1, 'EDIT must NOT overwrite meta.createdAt (write-once)');
    strictEqual(meta2.get('lastEditorId'), 'uB', 'EDIT must update meta.lastEditorId every commit');
    ok(meta2.get('updatedAt') >= createdAt1, 'EDIT must update meta.updatedAt every commit');
  },
);
