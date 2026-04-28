// tests/phase29/midDragCancel.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-02 lands
// src/lib/collab/crdtAnnotationBridge.js. Plan 29-05 wires the actual mid-drag
// cancellation event surface; this test only validates the bridge contract:
// when fabricObject.__dragCancelled === true, the bridge MUST NOT write to Y.Doc.

import { test } from 'node:test';
import { strictEqual } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/crdtAnnotationBridge.js');

function skipReason() {
  return !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false;
}

function makeFakeYDoc() {
  const calls = [];
  return {
    transact(fn, origin) { calls.push({ origin }); fn(); },
    __calls: calls,
  };
}

function makeFakeYMap() {
  const inner = new Map();
  return {
    get(k) {
      if (!inner.has(k)) {
        const sub = { __sets: [], get: () => sub, set: (kk, v) => sub.__sets.push({ kk, v }), has: () => false };
        inner.set(k, sub);
      }
      return inner.get(k);
    },
    has: (k) => inner.has(k),
  };
}

test(
  'mid-drag cancel #1: bridge does NOT write when fabricObject.__dragCancelled === true',
  { skip: skipReason() },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = makeFakeYDoc();
    const yMap = makeFakeYMap();
    const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    const fabricObject = {
      left: 100, top: 100, data: { id: 'annoX' },
      __dragCancelled: true,
      toObject: () => ({ left: 100, top: 100 }),
    };
    applyFabricCommit(ydoc, yMap, fabricObject, origin, { userId: 'u1', deviceId: 'd1' });
    strictEqual(ydoc.__calls.length, 0, '__dragCancelled === true must short-circuit the commit before transact');
  },
);

test(
  'mid-drag cancel #2: bridge does NOT write when annoId missing AND drag cancelled (defensive overlap)',
  { skip: skipReason() },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = makeFakeYDoc();
    const yMap = makeFakeYMap();
    const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    const fabricObject = {
      left: 100, top: 100, data: {}, // no id
      __dragCancelled: true,
      toObject: () => ({ left: 100, top: 100 }),
    };
    applyFabricCommit(ydoc, yMap, fabricObject, origin, { userId: 'u1', deviceId: 'd1' });
    strictEqual(ydoc.__calls.length, 0, 'defensive: missing annoId AND __dragCancelled both short-circuit');
  },
);
