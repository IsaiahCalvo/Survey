// tests/highlightSyncDeleteDiff.test.mjs
//
// Bug 2 fix: legacy highlight sync path only upserts, never deletes. When a
// user erases part of a highlight on Mac, the local copy disappears but the
// cloud row stays put — Windows keeps drawing the original. Fix: detect
// deleted highlight IDs by diffing the last-synced state against the current
// state, then call deleteAnnotations() before the upsert.
//
// This test covers the pure helper (`diffDeletedHighlightIds`) so we can
// validate the diff math without mocking Supabase.

import test from 'node:test';
import assert from 'node:assert/strict';
// Imports from the pure helper module so the test runs under `node --test`
// without trying to load the Supabase client (which uses Vite-only resolution).
import { diffDeletedHighlightIds } from '../src/services/highlightSyncDiff.js';

test('diffDeletedHighlightIds: returns empty when no prior state', () => {
  assert.deepEqual(
    diffDeletedHighlightIds(null, { a: {}, b: {} }),
    [],
  );
  assert.deepEqual(
    diffDeletedHighlightIds(undefined, { a: {}, b: {} }),
    [],
  );
  assert.deepEqual(
    diffDeletedHighlightIds({}, { a: {}, b: {} }),
    [],
  );
});

test('diffDeletedHighlightIds: returns empty when nothing was deleted', () => {
  assert.deepEqual(
    diffDeletedHighlightIds({ a: {}, b: {} }, { a: {}, b: {} }),
    [],
  );
});

test('diffDeletedHighlightIds: returns IDs present in prior but missing from current', () => {
  const prior = { a: {}, b: {}, c: {} };
  const current = { a: {} };
  const result = diffDeletedHighlightIds(prior, current);
  assert.equal(result.length, 2);
  assert.ok(result.includes('b'));
  assert.ok(result.includes('c'));
});

test('diffDeletedHighlightIds: handles full erase (all highlights removed)', () => {
  const prior = { a: {}, b: {} };
  const current = {};
  assert.deepEqual(
    diffDeletedHighlightIds(prior, current).sort(),
    ['a', 'b'],
  );
});

test('diffDeletedHighlightIds: handles current null/undefined as empty', () => {
  const prior = { a: {}, b: {} };
  assert.deepEqual(diffDeletedHighlightIds(prior, null).sort(), ['a', 'b']);
  assert.deepEqual(diffDeletedHighlightIds(prior, undefined).sort(), ['a', 'b']);
});

test('diffDeletedHighlightIds: ignores additions (current-only IDs)', () => {
  // The function is for DELETE detection only — additions go through upsert,
  // not delete. So a new ID in current should not appear in the result.
  const prior = { a: {} };
  const current = { a: {}, b: {} };
  assert.deepEqual(diffDeletedHighlightIds(prior, current), []);
});
