// tests/calloutRealtimeEchoSuppression.test.mjs
//
// R2.3a Slice 5 — unit-level contract for the hook's remote callout apply:
// a realtime callout insert/update/delete must leave lastByPageRef.current
// === the state it just set, so the push effect's identity check
// (annotationsByPage === lastByPageRef.current) classifies the remote apply
// as already-synced and NEVER re-pushes it to the cloud (the remote-echo
// re-push / ping-pong bug).
//
// Functional simulation using the REAL bridge helpers
//      (deriveCalloutsFromByPage / applyCalloutListToByPage) composed the
//      exact way the hook composes them, with a React-setState-like state
//      cell + a ref object: after every remote apply the ref and the state
//      must be the SAME reference, and re-applying the same remote payload
//      must referential-bail (no new reference → no push scheduled).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCalloutsFromByPage,
  applyCalloutListToByPage,
} from '../src/utils/calloutAnnotationBridge.js';

// ---------------------------------------------------------------------------
// (Layer 1 — source assertions on useAnnotationCloudSync.js — was deleted
// 2026-07-17 together with the retired, unmounted hook module. The functional
// contract below survives it: it exercises the REAL bridge helpers
// (deriveCalloutsFromByPage / applyCalloutListToByPage), which remain live in
// useAnnotationDoc, and pins the referential-bail + non-callout-preservation
// guarantees any realtime apply composition depends on.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Functional contract — the composition itself, with the real helpers
// ---------------------------------------------------------------------------

const PAGE_SIZES = {
  1: { width: 612, height: 792 },
  2: { width: 816, height: 1056 },
};

function makeCallout(id, pageNumber, overrides = {}) {
  return {
    id,
    pageNumber,
    arrowTip: { x: 0.5, y: 0.25 },
    knee: { x: 0.3, y: 0.5 },
    textBoxPosition: { x: 0.1, y: 0.6 },
    textBoxWidth: 0.2,
    textBoxHeight: 0.1,
    text: `text for ${id}`,
    style: {
      fontFamily: 'Arial',
      fontSize: 14,
      fontColor: '#000000',
      borderColor: '#1e293b',
      lineThickness: 2,
    },
    ...overrides,
  };
}

/** Non-callout page object that must survive every remote apply untouched. */
const penStroke = {
  type: 'path',
  path: [['M', 10, 10], ['L', 50, 50]],
  stroke: '#ff0000',
  data: { type: 'pen' },
};

/** Mirror of the hook's upsertCalloutInList (realtime insert/update mutator). */
function upsertCalloutInList(prev, callout) {
  const list = Array.isArray(prev) ? prev : [];
  const id = callout.id || callout.annotationId;
  const idx = list.findIndex((c) => (c.id || c.annotationId) === id);
  if (idx >= 0) {
    return list.map((c, i) => (i === idx ? callout : c));
  }
  return [...list, callout];
}

/**
 * Harness mirroring the hook wiring:
 *   - stateCell ~ React state (functional updates)
 *   - lastByPageRef ~ the hook's lastByPageRef
 *   - applyRemote ~ applyRemoteCalloutToByPage, composed EXACTLY as in the hook
 *   - pushWouldSchedule ~ the push effect's identity check
 */
function makeHarness(initialByPage) {
  let state = initialByPage;
  const lastByPageRef = { current: initialByPage };
  const setAnnotationsByPage = (updater) => {
    state = typeof updater === 'function' ? updater(state) : updater;
  };
  const applyRemote = (mutator) => {
    setAnnotationsByPage((prev) => {
      const src = prev || {};
      const nextList = mutator(deriveCalloutsFromByPage(src));
      const merged = applyCalloutListToByPage(src, nextList, PAGE_SIZES);
      lastByPageRef.current = merged; // suppress local push echo
      return merged;
    });
  };
  return {
    applyRemote,
    getState: () => state,
    lastByPageRef,
    // The push effect bails when state === lastByPageRef.current.
    pushWouldSchedule: () => state !== lastByPageRef.current,
  };
}

describe('remote callout apply — lastByPageRef lockstep (echo suppression)', () => {
  it('remote INSERT leaves lastByPageRef === the state it set (no push scheduled)', () => {
    const h = makeHarness({ 1: { objects: [penStroke] } });
    h.applyRemote((list) => upsertCalloutInList(list, makeCallout('c-remote', 1)));
    assert.strictEqual(h.lastByPageRef.current, h.getState(),
      'ref and state must be the SAME reference after a remote insert');
    assert.equal(h.pushWouldSchedule(), false, 'push effect must see the apply as already-synced');
    // The callout actually landed…
    const derived = deriveCalloutsFromByPage(h.getState());
    assert.equal(derived.length, 1);
    assert.equal(derived[0].id, 'c-remote');
    // …and the non-callout object survived by reference.
    assert.strictEqual(
      h.getState()[1].objects.find((o) => o?.data?.type === 'pen'),
      penStroke
    );
  });

  it('remote UPDATE (move) leaves lastByPageRef === state and applies the move', () => {
    const h = makeHarness({ 1: { objects: [penStroke] } });
    h.applyRemote((list) => upsertCalloutInList(list, makeCallout('c-remote', 1)));
    const before = h.getState();
    h.applyRemote((list) => upsertCalloutInList(
      list,
      makeCallout('c-remote', 1, { arrowTip: { x: 0.9, y: 0.9 } })
    ));
    assert.notStrictEqual(h.getState(), before, 'a real remote move must produce a new snapshot');
    assert.strictEqual(h.lastByPageRef.current, h.getState());
    assert.equal(h.pushWouldSchedule(), false);
    const derived = deriveCalloutsFromByPage(h.getState());
    assert.equal(derived[0].arrowTip.x, 0.9);
  });

  it('remote DELETE leaves lastByPageRef === state and removes the callout', () => {
    const h = makeHarness({ 1: { objects: [penStroke] } });
    h.applyRemote((list) => upsertCalloutInList(list, makeCallout('c-remote', 1)));
    h.applyRemote((list) => (list || []).filter((c) => (c.id ?? c.annotationId) !== 'c-remote'));
    assert.strictEqual(h.lastByPageRef.current, h.getState());
    assert.equal(h.pushWouldSchedule(), false);
    assert.equal(deriveCalloutsFromByPage(h.getState()).length, 0);
    assert.strictEqual(
      h.getState()[1].objects.find((o) => o?.data?.type === 'pen'),
      penStroke,
      'delete must strip only callout objects'
    );
  });

  it('re-applying the SAME remote payload referential-bails (idempotent echo)', () => {
    const h = makeHarness({ 1: { objects: [penStroke] } });
    const payload = makeCallout('c-remote', 1);
    h.applyRemote((list) => upsertCalloutInList(list, payload));
    const after = h.getState();
    // A duplicate realtime delivery of the same row must be a no-op: the
    // fingerprint bail inside applyCalloutListToByPage returns the input
    // byPage reference, so state AND ref stay untouched.
    h.applyRemote((list) => upsertCalloutInList(list, makeCallout('c-remote', 1)));
    assert.strictEqual(h.getState(), after, 'duplicate remote apply must not mint a new snapshot');
    assert.strictEqual(h.lastByPageRef.current, after);
    assert.equal(h.pushWouldSchedule(), false);
  });

  it('remote apply on a multi-page doc keeps other pages\' objects untouched (by reference)', () => {
    const page2 = { objects: [penStroke] };
    const h = makeHarness({ 2: page2 });
    h.applyRemote((list) => upsertCalloutInList(list, makeCallout('c-p1', 1)));
    assert.strictEqual(h.lastByPageRef.current, h.getState());
    // The projector may rebuild page ENTRIES, but non-callout OBJECTS must
    // survive by reference (the bridge contract the derive model relies on).
    assert.strictEqual(
      h.getState()[2].objects.find((o) => o?.data?.type === 'pen'),
      penStroke,
      'non-callout objects on other pages must be preserved by reference'
    );
    assert.equal(h.getState()[2].objects.length, 1);
    assert.equal(deriveCalloutsFromByPage(h.getState()).length, 1);
  });
});
