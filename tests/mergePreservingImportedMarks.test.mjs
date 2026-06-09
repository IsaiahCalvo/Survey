import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePreservingImportedMarks } from '../src/utils/safeSnapshot.js';

const imported = (id) => ({ id, isPdfImported: true, type: 'path' });
const userMark = (id) => ({ id, type: 'rect' });

test('empty cloud does not wipe imported marks', () => {
  const prev = { 6: { objects: [imported('a'), imported('b')] }, 7: { objects: [imported('c')] } };
  const out = mergePreservingImportedMarks(prev, {});
  assert.equal(out[6].objects.length, 2);
  assert.equal(out[7].objects.length, 1);
});

test('partial cloud preserves imported marks the cloud lacks', () => {
  const prev = { 6: { objects: [imported('a')] }, 8: { objects: [imported('z')] } };
  const incoming = { 6: { objects: [userMark('u1')] } }; // cloud only has page 6, user mark
  const out = mergePreservingImportedMarks(prev, incoming);
  assert.equal(out[6].objects.length, 2, 'keeps cloud user mark + preserved imported');
  assert.equal(out[8].objects.length, 1, 'page 8 imported mark survives');
});

test('no duplication when cloud already has the imported mark by id', () => {
  const prev = { 6: { objects: [imported('a')] } };
  const incoming = { 6: { objects: [imported('a')] } };
  const out = mergePreservingImportedMarks(prev, incoming);
  assert.equal(out[6].objects.length, 1);
});

test('returns incoming identity unchanged when nothing to preserve', () => {
  const prev = { 6: { objects: [userMark('u')] } }; // no imported marks
  const incoming = { 6: { objects: [userMark('v')] } };
  const out = mergePreservingImportedMarks(prev, incoming);
  assert.equal(out, incoming, 'same reference — no churn in the common case');
});

test('null/empty prev is safe', () => {
  const incoming = { 1: { objects: [] } };
  assert.equal(mergePreservingImportedMarks(null, incoming), incoming);
  assert.equal(mergePreservingImportedMarks({}, incoming), incoming);
});

// ---------------------------------------------------------------------------
// PATCH-DELETION SAFETY TEST — KAL-256 §2.4
//
// This test is the regression tripwire for the `mergePreservingImportedMarks`
// patch. It constructs the exact scenario the patch was written for (a cloud
// hydrate that returns marks from the user only, with no imported marks) and
// asserts the patch keeps the imported marks alive.
//
// HOW TO VERIFY IT IS LOAD-BEARING:
//   Remove the body of `mergePreservingImportedMarks` and replace it with
//   `return incoming;` (the no-patch pass-through). The assertions below
//   will fail because:
//     - `out[1].objects.length` would be 1 (only the app mark), not 2
//     - The imported mark `imported('pdf-A')` would be absent from the result
//     - The negative-control assertion (incoming identity unchanged) would
//       still pass — confirming that only the protection branch, not the
//       identity fast-path, is exercised by the positive case.
// ---------------------------------------------------------------------------

test('[KAL-256] patch-deletion safety: mixed page — imported mark survives cloud hydrate that omits it', () => {
  // Prev state: user drew an app mark AND the PDF importer added an imported
  // mark on the same page 1. This is the real scenario right after a first
  // open where the importer ran but the cloud push hadn't written yet.
  const prev = {
    1: {
      objects: [
        userMark('user-drawn-1'),
        imported('pdf-A'),
      ],
    },
  };

  // The cloud comes back with ONLY the user-drawn mark (the imported mark was
  // never written to Supabase — this is the exact vanish-bug scenario).
  const incoming = {
    1: {
      objects: [userMark('user-drawn-1')],
    },
  };

  const out = mergePreservingImportedMarks(prev, incoming);

  // The patch MUST preserve the imported mark alongside the incoming app mark.
  assert.equal(out[1].objects.length, 2, 'imported mark must survive the cloud hydrate');
  const ids = out[1].objects.map((o) => o.id);
  assert.ok(ids.includes('pdf-A'), 'pdf-A imported mark must be present in merged result');
  assert.ok(ids.includes('user-drawn-1'), 'user-drawn app mark from cloud must be present');

  // The result must NOT be the same reference as incoming (a new page object
  // was constructed to splice in the imported mark).
  assert.notEqual(out, incoming, 'patch returns a new object, not incoming identity');
  assert.notEqual(out[1], incoming[1], 'page 1 is a new object containing the injected mark');
});

test('[KAL-256] patch-deletion safety: negative control — incoming already has the imported mark, no duplication', () => {
  // When the cloud correctly contains the imported mark (future steady state
  // after the rebuild), the patch must return `incoming` identity-unchanged so
  // callers' shallow-equality checks don't trigger spurious re-renders.
  const prev = {
    1: { objects: [userMark('user-drawn-1'), imported('pdf-A')] },
  };
  const incoming = {
    1: { objects: [userMark('user-drawn-1'), imported('pdf-A')] },
  };

  const out = mergePreservingImportedMarks(prev, incoming);

  // No duplication: still exactly 2 objects.
  assert.equal(out[1].objects.length, 2, 'no duplication when cloud already carries the imported mark');
  // Identity preserved — function returns the exact same reference.
  assert.equal(out, incoming, 'incoming identity preserved when nothing needs to be added');
});
