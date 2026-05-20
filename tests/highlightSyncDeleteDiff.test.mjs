// tests/highlightSyncDeleteDiff.test.mjs
//
// Bug 2 fix: legacy survey marker sync path only upserts, never deletes. When a
// user erases part of a survey marker on Mac, the local copy disappears but the
// cloud row stays put — Windows keeps drawing the original. Fix: detect
// deleted survey marker IDs by diffing the last-synced state against the current
// state, then call deleteAnnotations() before the upsert.
//
// This test covers the pure helper (`diffDeletedSurveyMarkerIds`) so we can
// validate the diff math without mocking Supabase.

import test from 'node:test';
import assert from 'node:assert/strict';
// Imports from the pure helper module so the test runs under `node --test`
// without trying to load the Supabase client (which uses Vite-only resolution).
import { diffDeletedSurveyMarkerIds } from '../src/services/surveyMarkerSyncDiff.js';

test('diffDeletedSurveyMarkerIds: returns empty when no prior state', () => {
  assert.deepEqual(
    diffDeletedSurveyMarkerIds(null, { a: {}, b: {} }),
    [],
  );
  assert.deepEqual(
    diffDeletedSurveyMarkerIds(undefined, { a: {}, b: {} }),
    [],
  );
  assert.deepEqual(
    diffDeletedSurveyMarkerIds({}, { a: {}, b: {} }),
    [],
  );
});

test('diffDeletedSurveyMarkerIds: returns empty when nothing was deleted', () => {
  assert.deepEqual(
    diffDeletedSurveyMarkerIds({ a: {}, b: {} }, { a: {}, b: {} }),
    [],
  );
});

test('diffDeletedSurveyMarkerIds: returns IDs present in prior but missing from current', () => {
  const prior = { a: {}, b: {}, c: {} };
  const current = { a: {} };
  const result = diffDeletedSurveyMarkerIds(prior, current);
  assert.equal(result.length, 2);
  assert.ok(result.includes('b'));
  assert.ok(result.includes('c'));
});

test('diffDeletedSurveyMarkerIds: handles full erase (all survey markers removed)', () => {
  const prior = { a: {}, b: {} };
  const current = {};
  assert.deepEqual(
    diffDeletedSurveyMarkerIds(prior, current).sort(),
    ['a', 'b'],
  );
});

test('diffDeletedSurveyMarkerIds: handles current null/undefined as empty', () => {
  const prior = { a: {}, b: {} };
  assert.deepEqual(diffDeletedSurveyMarkerIds(prior, null).sort(), ['a', 'b']);
  assert.deepEqual(diffDeletedSurveyMarkerIds(prior, undefined).sort(), ['a', 'b']);
});

test('diffDeletedSurveyMarkerIds: ignores additions (current-only IDs)', () => {
  // The function is for DELETE detection only — additions go through upsert,
  // not delete. So a new ID in current should not appear in the result.
  const prior = { a: {} };
  const current = { a: {}, b: {} };
  assert.deepEqual(diffDeletedSurveyMarkerIds(prior, current), []);
});
