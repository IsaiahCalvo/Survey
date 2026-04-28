// tests/phase29/identityContract.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-02 lands
// src/lib/collab/crdtAnnotationBridge.js.
//
// Defends Pitfall 6: registry lifecycle. annoId is the stable identity bridging
// SVG / Fabric / Y.Map. The registry (Map of annoId → fabricObject) is the source
// of truth for "which Fabric instance currently represents this annotation"; it
// must clear on unmount so stale references can't leak into a new mount cycle.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/crdtAnnotationBridge.js');

function skipReason() {
  return !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false;
}

// Build a minimal yMap fixture with a fabric subdoc so applyYUpdateToFabric has
// something to read.
function makeYMapWithAnno(annoId, fabricProps) {
  const fabricMap = new Map();
  for (const [k, v] of Object.entries(fabricProps)) fabricMap.set(k, v);
  const annoMap = new Map();
  annoMap.set('fabric', { get: (k) => fabricMap.get(k), entries: () => fabricMap.entries() });
  const yMap = new Map();
  yMap.set(annoId, { get: (k) => annoMap.get(k) });
  return {
    get: (k) => yMap.get(k),
    has: (k) => yMap.has(k),
  };
}

test(
  'Pitfall 6 #1: applyYUpdateToFabric calls Fabric .set() when registry has annoId',
  { skip: skipReason() },
  async () => {
    const { applyYUpdateToFabric } = await import(TARGET);
    const yMap = makeYMapWithAnno('a1', { left: 50, top: 60 });
    const setSpy = [];
    const fakeFabric = { set(key, val) { setSpy.push({ key, val }); } };
    const registry = new Map();
    registry.set('a1', fakeFabric);
    applyYUpdateToFabric(yMap, 'a1', registry);
    ok(setSpy.length > 0, 'Fabric .set must be called when registry has the annoId');
  },
);

test(
  'Pitfall 6 #2: applyYUpdateToFabric returns silently when registry.get(annoId) is undefined',
  { skip: skipReason() },
  async () => {
    const { applyYUpdateToFabric } = await import(TARGET);
    const yMap = makeYMapWithAnno('a1', { left: 50 });
    const registry = new Map(); // empty
    // Must not throw.
    applyYUpdateToFabric(yMap, 'a1', registry);
    // Nothing else to assert — silent no-op is the contract.
  },
);

test(
  'Pitfall 6 #3: annoId derived from fabricObject.data?.id ?? fabricObject.data?.annoId — both shapes work',
  { skip: skipReason() },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const calls = [];
    const ydoc = { transact(fn, origin) { calls.push({ origin }); fn(); } };
    const yMapAnnotations = (() => {
      const inner = new Map();
      return {
        get(k) {
          if (!inner.has(k)) {
            const sub = { __sets: [], get: (kk) => { if (!inner.has(`${k}.${kk}`)) inner.set(`${k}.${kk}`, sub); return sub; }, set: (kk, v) => sub.__sets.push({ kk, v }), has: () => false };
            inner.set(k, sub);
          }
          return inner.get(k);
        },
        has: (k) => inner.has(k),
      };
    })();
    const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    // Shape A: data.id
    applyFabricCommit(ydoc, yMapAnnotations, {
      left: 1, top: 1, data: { id: 'shapeA' },
      toObject: () => ({ left: 1, top: 1 }),
    }, origin, { userId: 'u1', deviceId: 'd1' });
    // Shape B: data.annoId fallback
    applyFabricCommit(ydoc, yMapAnnotations, {
      left: 2, top: 2, data: { annoId: 'shapeB' },
      toObject: () => ({ left: 2, top: 2 }),
    }, origin, { userId: 'u1', deviceId: 'd1' });
    strictEqual(calls.length, 2, 'both shapes must produce a transact call (annoId resolved from either data.id or data.annoId)');
  },
);

test(
  'Pitfall 6 #4: registry.clear() between mounts — applyYUpdateToFabric is silent on the cleared registry',
  { skip: skipReason() },
  async () => {
    const { applyYUpdateToFabric } = await import(TARGET);
    const yMap = makeYMapWithAnno('a1', { left: 50 });
    const setSpy = [];
    const fakeFabric = { set(key, val) { setSpy.push({ key, val }); } };
    const registry = new Map();
    registry.set('a1', fakeFabric);
    // Before clear: write happens.
    applyYUpdateToFabric(yMap, 'a1', registry);
    const beforeClearCount = setSpy.length;
    ok(beforeClearCount > 0);
    // Simulate unmount lifecycle.
    registry.clear();
    applyYUpdateToFabric(yMap, 'a1', registry);
    strictEqual(setSpy.length, beforeClearCount, 'after registry.clear(), no further .set must be invoked on the stale Fabric ref');
  },
);
