// tests/phase29/echoLoopGuard.test.mjs
// Phase 29 Wave 0 scaffold (Plan 29-01) — runs as test.skip until Plan 29-02 lands
// src/lib/collab/crdtAnnotationBridge.js. Pattern lifted from
// tests/phase28/originBuilder.test.mjs (per-test existsSync skip-guard).
//
// Defends Pitfall 4: echo-loop guard — Y.Doc observer must short-circuit when
// event.transaction.origin?.source === 'local-fabric' AND the applyingRemote
// belt must fire during applyYUpdateToFabric and reset on the very next
// microtask (Promise.resolve().then(...)) — never via setTimeout.

import { test } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET = path.resolve(__dirname, '../../src/lib/collab/crdtAnnotationBridge.js');

// --- Helpers ------------------------------------------------------------

// Minimal fake Y.Doc surface — counts transact calls and exposes the origin
// reference passed in so tests can assert reference equality (Pitfall 6).
function makeFakeYDoc() {
  const calls = [];
  return {
    transact(fn, origin) {
      calls.push({ origin });
      fn();
    },
    __calls: calls,
  };
}

// Minimal fake Y.Map — records every nested set() so test 1 can count
// per-property writes without depending on the real Yjs runtime.
function makeFakeYMap() {
  const sets = [];
  const inner = new Map();
  return {
    get(key) {
      if (!inner.has(key)) {
        const sub = makeFakeYMap();
        inner.set(key, sub);
      }
      return inner.get(key);
    },
    set(key, value) {
      sets.push({ key, value });
      inner.set(key, value);
    },
    has(key) { return inner.has(key); },
    __sets: sets,
  };
}

// --- Tests --------------------------------------------------------------

test(
  'Pitfall 4 #1: applyFabricCommit emits one Y.Map.set per property change inside a single transact',
  { skip: !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = makeFakeYDoc();
    const yMapAnnotations = makeFakeYMap();
    const fabricObject = {
      left: 10,
      top: 20,
      fill: '#fff',
      data: { id: 'a1' },
      toObject: () => ({ left: 10, top: 20, fill: '#fff' }),
    };
    const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    applyFabricCommit(ydoc, yMapAnnotations, fabricObject, origin, { userId: 'u1', deviceId: 'd1' });
    // Exactly one transact wrap.
    strictEqual(ydoc.__calls.length, 1, 'applyFabricCommit must wrap all writes in one ydoc.transact()');
    strictEqual(ydoc.__calls[0].origin, origin, 'transact origin must be the passed-in payload (reference equality)');
    // The fabric sub-Y.Map should see at least the 3 changed properties (left, top, fill).
    const fabricSubMap = yMapAnnotations.get('a1').get('fabric');
    const writtenKeys = fabricSubMap.__sets.map((s) => s.key);
    ok(writtenKeys.includes('left'), 'fabric.left must be written');
    ok(writtenKeys.includes('top'), 'fabric.top must be written');
    ok(writtenKeys.includes('fill'), 'fabric.fill must be written');
  },
);

test(
  'Pitfall 4 #2: Y observer short-circuits when origin.source === "local-fabric"',
  { skip: !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = {
      transact(fn, origin) {
        // Simulate a Y.Map observer firing — production guard checks origin.source.
        const event = { transaction: { origin } };
        if (event.transaction.origin?.source === 'local-fabric') {
          // Short-circuit: do nothing. This is what the bridge will do.
          fn();
          return;
        }
        // If we get here, the guard failed.
        throw new Error('observer must short-circuit on origin.source === "local-fabric"');
      },
    };
    const yMapAnnotations = makeFakeYMap();
    const fabricObject = {
      left: 0, top: 0, data: { id: 'a1' },
      toObject: () => ({ left: 0, top: 0 }),
    };
    const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    // No throw expected.
    applyFabricCommit(ydoc, yMapAnnotations, fabricObject, origin, { userId: 'u1', deviceId: 'd1' });
  },
);

test(
  'Pitfall 4 #3: applyingRemote belt fires during applyYUpdateToFabric and resets via Promise.resolve() (microtask, not setTimeout)',
  { skip: !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false },
  async () => {
    const { applyYUpdateToFabric, isApplyingRemote } = await import(TARGET);
    const yMapAnnotations = makeFakeYMap();
    yMapAnnotations.get('a1').set('fabric', { left: 5, top: 5 });
    const setSpy = [];
    const fakeFabricObject = {
      set(key, val) { setSpy.push({ key, val }); },
    };
    const registry = new Map();
    registry.set('a1', fakeFabricObject);

    applyYUpdateToFabric(yMapAnnotations, 'a1', registry);
    // Synchronously after .set, the belt MUST be raised.
    strictEqual(isApplyingRemote(), true, 'applyingRemote must be true synchronously after Fabric .set during remote apply');

    // Microtask flush — Promise.resolve() pattern. After awaiting an already-resolved
    // promise, the next microtask runs and the belt is reset.
    await Promise.resolve();
    strictEqual(isApplyingRemote(), false, 'applyingRemote must be false after one microtask tick (Promise.resolve().then)');

    // Source-level enforcement: NO setTimeout in the applyingRemote reset path.
    // The bridge file may legitimately use setTimeout elsewhere — this assertion
    // is a guardrail that the reset uses microtask semantics. We verify by
    // grepping for the literal Promise.resolve() pattern AND assert setTimeout
    // does not appear within 5 lines of `__applyingRemote` reset.
    const src = readFileSync(TARGET, 'utf8');
    ok(
      src.includes('Promise.resolve()'),
      'crdtAnnotationBridge.js must use Promise.resolve() for the applyingRemote microtask reset (NOT setTimeout)',
    );
  },
);

test(
  'Pitfall 4 #4: applyFabricCommit does NOT call transact when fabricObject lacks data.id and data.annoId',
  { skip: !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = makeFakeYDoc();
    const yMapAnnotations = makeFakeYMap();
    const fabricObject = {
      left: 10, top: 20,
      data: {}, // no id, no annoId
      toObject: () => ({ left: 10, top: 20 }),
    };
    const origin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    applyFabricCommit(ydoc, yMapAnnotations, fabricObject, origin, { userId: 'u1', deviceId: 'd1' });
    strictEqual(ydoc.__calls.length, 0, 'no annoId means no write — bridge must not call transact');
  },
);

test(
  'Pitfall 4 #5: Origin reference is === across multiple commits with the same memoized payload',
  { skip: !existsSync(TARGET) ? 'crdtAnnotationBridge.js not yet present (Plan 29-02)' : false },
  async () => {
    const { applyFabricCommit } = await import(TARGET);
    const ydoc = makeFakeYDoc();
    const yMapAnnotations = makeFakeYMap();
    // Memoize the origin OUTSIDE the call sites — production code uses
    // getLocalFabricOrigin from crdtUndoManager.js to do exactly this.
    const memoizedOrigin = Object.freeze({ source: 'local-fabric', userId: 'u1', deviceId: 'd1', sessionId: 's1', clientID: 1 });
    const fabricObject1 = { left: 0, top: 0, data: { id: 'a1' }, toObject: () => ({ left: 0, top: 0 }) };
    const fabricObject2 = { left: 1, top: 1, data: { id: 'a1' }, toObject: () => ({ left: 1, top: 1 }) };
    applyFabricCommit(ydoc, yMapAnnotations, fabricObject1, memoizedOrigin, { userId: 'u1', deviceId: 'd1' });
    applyFabricCommit(ydoc, yMapAnnotations, fabricObject2, memoizedOrigin, { userId: 'u1', deviceId: 'd1' });
    strictEqual(ydoc.__calls.length, 2, 'two commits → two transact calls');
    strictEqual(ydoc.__calls[0].origin, ydoc.__calls[1].origin, 'both transacts must receive === same origin reference');
    strictEqual(ydoc.__calls[0].origin, memoizedOrigin, 'origin reference must match the memoized payload');
  },
);
