import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countSnapshotItems, resolveSafeSnapshot } from '../src/utils/safeSnapshot.js';

test('counts annotation page snapshots by object count', () => {
  assert.equal(countSnapshotItems({
    1: { objects: [{ id: 'a' }, { id: 'b' }] },
    2: { objects: [{ id: 'c' }] },
  }, 'annotation-pages'), 3);
});

test('cloud snapshots preserve last known good view when incoming data is empty and not confirmed', () => {
  const current = { a: { id: 'a' } };
  const result = resolveSafeSnapshot({
    current,
    incoming: {},
    cloudBacked: true,
    kind: 'object-map',
    context: 'survey-hydrate',
  });

  assert.equal(result.preserved, true);
  assert.equal(result.value, current);
});

test('confirmed empty cloud snapshots are allowed to clear state', () => {
  const result = resolveSafeSnapshot({
    current: { a: { id: 'a' } },
    incoming: {},
    cloudBacked: true,
    confirmedEmpty: true,
    kind: 'object-map',
    context: 'confirmed-delete',
  });

  assert.equal(result.preserved, false);
  assert.deepEqual(result.value, {});
});

test('non-empty incoming snapshots replace stale current state', () => {
  const incoming = { b: { id: 'b' } };
  const result = resolveSafeSnapshot({
    current: { a: { id: 'a' } },
    incoming,
    cloudBacked: true,
    kind: 'object-map',
    context: 'hydrate',
  });

  assert.equal(result.preserved, false);
  assert.equal(result.value, incoming);
});

// ---------------------------------------------------------------------------
// PATCH-DELETION SAFETY TEST — KAL-256 §2.4
//
// This test is the regression tripwire for the `resolveSafeSnapshot`
// empty-cloud guard. It proves that when a cloud hydrate comes back empty
// while the local state has marks, the guard fires and returns the safe
// (non-blanking) snapshot.
//
// HOW TO VERIFY IT IS LOAD-BEARING:
//   Remove the `preserve` guard and change the return to always use `incoming`
//   (i.e. replace `preserve ? current : (incoming ?? …)` with just `incoming`).
//   The first assertion below — `result.value === current` — will fail because
//   `incoming` is `{}` and the local marks would be wiped.
//   The inverse test (non-empty incoming is not blocked) will still pass,
//   showing that it is specifically the guard branch being tested.
// ---------------------------------------------------------------------------

test('[KAL-256] patch-deletion safety: empty-cloud guard — local marks not wiped when cloud hydrates to zero annotations', () => {
  // Simulate: the cloud document_annotations row-sweep comes back with nothing
  // while the local annotationsByPage still has marks. This is the exact
  // condition (cloudBacked=true, currentHasData=true, incomingEmpty=true,
  // confirmedEmpty=false) that the guard was introduced to catch.
  const localMarks = {
    1: { objects: [{ id: 'user-a', type: 'rect' }, { id: 'user-b', type: 'path' }] },
    3: { objects: [{ id: 'pdf-import-c', isPdfImported: true, type: 'path' }] },
  };

  const result = resolveSafeSnapshot({
    current: localMarks,
    incoming: {},            // cloud returned empty
    cloudBacked: true,       // this is a cloud-synced document
    confirmedEmpty: false,   // NOT a confirmed delete — likely a transient gap
    kind: 'annotation-pages',
    context: 'cloud-hydrate-empty-test',
  });

  // Guard must fire: preserved===true and the local marks are kept.
  assert.equal(result.preserved, true, 'guard must fire when cloud is empty and local has data');
  assert.equal(result.value, localMarks, 'returned value must be the local marks, not the empty incoming');
  assert.equal(result.currentCount, 3, 'currentCount reflects the 3 local annotation objects');
  assert.equal(result.incomingCount, 0, 'incomingCount is 0 — empty cloud');
});

test('[KAL-256] patch-deletion safety: inverse — non-empty cloud is never blocked by the guard', () => {
  // When the cloud legitimately has content (e.g. marks were properly saved),
  // the guard must NOT block the update so the local state can receive new marks
  // from the cloud without interference.
  const localMarks = { 1: { objects: [{ id: 'stale-local', type: 'rect' }] } };
  const cloudMarks = {
    1: { objects: [{ id: 'cloud-mark-x', type: 'path' }, { id: 'cloud-mark-y', type: 'path' }] },
  };

  const result = resolveSafeSnapshot({
    current: localMarks,
    incoming: cloudMarks,
    cloudBacked: true,
    confirmedEmpty: false,
    kind: 'annotation-pages',
    context: 'cloud-hydrate-nonempty-test',
  });

  // Guard must NOT fire: the incoming cloud marks replace local state.
  assert.equal(result.preserved, false, 'guard must NOT fire when cloud has data');
  assert.equal(result.value, cloudMarks, 'returned value must be the cloud marks');
});
