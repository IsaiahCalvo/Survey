// tests/calloutDeriveModel.test.mjs
//
// R2.2 Slice 2 (THE FLIP) — node-level contract tests for the setCallouts /
// setCalloutsIfPersistedChanged adapter semantics, exercised through the pure
// helpers exactly the way PDFViewer.jsx composes them:
//
//   setCallouts(updater) ≡ setAnnotationsByPage(prev =>
//     applyCalloutListToByPage(
//       prev,
//       resolveUpdater(updater, deriveCalloutsFromByPage(prev)),
//       pageSizes))
//
// Covered: function-updater form, value form, React-setState prev-list
// semantics, the persisted-fingerprint bail (no-op writes and transient-only
// churn return the SAME byPage reference), and a create → update → delete
// lifecycle reflected in the derived list with non-callout objects preserved
// by reference throughout.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveCalloutsFromByPage,
  applyCalloutListToByPage,
} from '../src/utils/calloutAnnotationBridge.js';

const PAGE_SIZES = {
  1: { width: 612, height: 792 },
  2: { width: 816, height: 1056 },
};

/** Mirror of the adapter's updater resolution (React setState semantics). */
function resolveUpdater(updater, prevList) {
  return typeof updater === 'function' ? updater(prevList) : updater;
}

/** The setCallouts adapter body as a pure function of (byPage, updater). */
function adapterSetCallouts(byPage, updater, pageSizes = PAGE_SIZES) {
  return applyCalloutListToByPage(
    byPage,
    resolveUpdater(updater, deriveCalloutsFromByPage(byPage)),
    pageSizes
  );
}

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

/** A non-callout page object (pen stroke) that must survive every write. */
const penStroke = {
  type: 'path',
  path: [['M', 10, 10], ['L', 50, 50]],
  stroke: '#ff0000',
  data: { type: 'pen' },
};

function byPageWithPenAndCallout() {
  const withCallout = adapterSetCallouts(
    { 1: { objects: [penStroke] } },
    [makeCallout('c-a', 1)]
  );
  return withCallout;
}

describe('setCallouts adapter — value form', () => {
  it('writes a callout list into byPage and derives it back', () => {
    const next = adapterSetCallouts({}, [makeCallout('c-a', 1)]);
    const derived = deriveCalloutsFromByPage(next);
    assert.equal(derived.length, 1);
    assert.equal(derived[0].id, 'c-a');
    assert.equal(derived[0].pageNumber, 1);
    assert.equal(derived[0].text, 'text for c-a');
  });

  it('preserves non-callout objects by reference', () => {
    const next = byPageWithPenAndCallout();
    const objects = next[1].objects;
    assert.strictEqual(
      objects.find((o) => o?.data?.type === 'pen'),
      penStroke,
      'pen stroke must survive the callout write untouched (same reference)'
    );
    assert.equal(objects.filter((o) => o?.data?.type === 'callout').length, 1);
  });
});

describe('setCallouts adapter — function-updater form', () => {
  it('passes the CURRENT derived list as prev (React setState semantics)', () => {
    const byPage = byPageWithPenAndCallout();
    let seenPrev = null;
    adapterSetCallouts(byPage, (prev) => {
      seenPrev = prev;
      return prev;
    });
    assert.ok(Array.isArray(seenPrev), 'updater must receive an array');
    assert.equal(seenPrev.length, 1);
    assert.equal(seenPrev[0].id, 'c-a');
  });

  it('create through prev => [...prev, next] lands in the derived list', () => {
    const byPage = byPageWithPenAndCallout();
    const next = adapterSetCallouts(byPage, (prev) => [...prev, makeCallout('c-b', 2)]);
    const ids = deriveCalloutsFromByPage(next).map((c) => c.id);
    assert.deepEqual(ids, ['c-a', 'c-b']);
    // page-2 projection created alongside the untouched page-1 pen stroke
    assert.strictEqual(
      next[1].objects.find((o) => o?.data?.type === 'pen'),
      penStroke
    );
    assert.equal(
      next[2].objects.filter((o) => o?.data?.type === 'callout').length,
      1
    );
  });

  it('update through prev.map() is reflected in the derived list', () => {
    const byPage = byPageWithPenAndCallout();
    const next = adapterSetCallouts(byPage, (prev) =>
      prev.map((c) => (c.id === 'c-a' ? { ...c, text: 'edited text' } : c))
    );
    assert.notStrictEqual(next, byPage, 'a real edit must produce a new byPage');
    const derived = deriveCalloutsFromByPage(next);
    assert.equal(derived[0].text, 'edited text');
  });

  it('delete through prev.filter() strips the projected object and empties the derived list', () => {
    const byPage = byPageWithPenAndCallout();
    const next = adapterSetCallouts(byPage, (prev) => prev.filter((c) => c.id !== 'c-a'));
    assert.equal(deriveCalloutsFromByPage(next).length, 0);
    assert.equal(
      next[1].objects.some((o) => o?.data?.type === 'callout'),
      false,
      'no ghost callout object may remain after delete-to-empty'
    );
    assert.strictEqual(
      next[1].objects.find((o) => o?.data?.type === 'pen'),
      penStroke,
      'non-callout objects must survive delete-to-empty by reference'
    );
  });
});

describe('setCalloutsIfPersistedChanged semantics — persisted-fingerprint bail', () => {
  it('identity write (prev => prev) returns the SAME byPage reference', () => {
    const byPage = byPageWithPenAndCallout();
    const next = adapterSetCallouts(byPage, (prev) => prev);
    assert.strictEqual(next, byPage);
  });

  it('re-writing the derived list verbatim is a referential no-op', () => {
    const byPage = byPageWithPenAndCallout();
    const next = adapterSetCallouts(byPage, deriveCalloutsFromByPage(byPage));
    assert.strictEqual(next, byPage);
  });

  it('transient-only churn (isSelected) does not produce a new byPage', () => {
    const byPage = byPageWithPenAndCallout();
    const next = adapterSetCallouts(byPage, (prev) =>
      prev.map((c) => ({ ...c, isSelected: true }))
    );
    assert.strictEqual(
      next,
      byPage,
      'transient fields are stripped by the sync fingerprint — must bail'
    );
  });

  it('empty write onto an already-callout-free byPage is a referential no-op', () => {
    const byPage = { 1: { objects: [penStroke] } };
    const next = adapterSetCallouts(byPage, []);
    assert.strictEqual(next, byPage);
  });
});

describe('derive/apply round-trip invariants used by the flip', () => {
  it('derive(apply(byPage, list)) preserves persisted content losslessly', () => {
    const original = makeCallout('c-meta', 2, {
      meta: { authorId: 'user-123' },
      groupId: 'grp-7',
      moduleId: 'mod-1',
      regionId: 'reg-9',
    });
    const byPage = adapterSetCallouts({}, [original]);
    const derived = deriveCalloutsFromByPage(byPage)[0];
    assert.equal(derived.id, 'c-meta');
    assert.equal(derived.pageNumber, 2);
    assert.equal(derived.meta?.authorId, 'user-123');
    assert.equal(derived.groupId, 'grp-7');
    assert.equal(derived.moduleId, 'mod-1');
    assert.equal(derived.regionId, 'reg-9');
    assert.deepEqual(derived.arrowTip, original.arrowTip);
    assert.deepEqual(derived.knee, original.knee);
    assert.deepEqual(derived.textBoxPosition, original.textBoxPosition);
  });

  it('apply(byPage, derive(byPage)) === byPage (the restore-path merge no-op)', () => {
    const byPage = byPageWithPenAndCallout();
    assert.strictEqual(
      applyCalloutListToByPage(byPage, deriveCalloutsFromByPage(byPage), PAGE_SIZES),
      byPage
    );
  });
});
