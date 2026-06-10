// tests/surveyMarkerSyncSafetyBranches.test.mjs — KAL-92 regression coverage.
// COMPLEMENTS src/utils/__tests__/surveyMarkerSyncSafety.test.mjs (which pins
// the hydrate-empty-delete bug case, the post-hydrate run:true inverse, and
// the PDFViewer wiring contract). This file covers every OTHER branch of
// shouldRunSurveyMarkerSync so no prerequisite or priority rule can silently
// change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunSurveyMarkerSync } from '../src/utils/surveyMarkerSyncSafety.js';

const READY_BASE = {
  documentSyncEnabled: true,
  hasDocumentId: true,
  hasUserId: true,
  syncBlocked: false,
  currentCount: 3,
  priorCount: 2,
  hydrationReady: true,
};

test('missing document id disables sync', () => {
  const d = shouldRunSurveyMarkerSync({ ...READY_BASE, hasDocumentId: false });
  assert.deepEqual(d, { run: false, reason: 'sync-disabled' });
});

test('missing user id disables sync', () => {
  const d = shouldRunSurveyMarkerSync({ ...READY_BASE, hasUserId: false });
  assert.deepEqual(d, { run: false, reason: 'sync-disabled' });
});

test('document sync disabled flag disables sync', () => {
  const d = shouldRunSurveyMarkerSync({ ...READY_BASE, documentSyncEnabled: false });
  assert.deepEqual(d, { run: false, reason: 'sync-disabled' });
});

test('blocked sync disables sync', () => {
  const d = shouldRunSurveyMarkerSync({ ...READY_BASE, syncBlocked: true });
  assert.deepEqual(d, { run: false, reason: 'sync-disabled' });
});

test('branch priority: sync-disabled wins over the hydrate-empty guard', () => {
  // Both conditions true at once — prerequisites are checked first, so the
  // reason must be sync-disabled, not hydrate-empty-delete-guard.
  const d = shouldRunSurveyMarkerSync({
    ...READY_BASE,
    syncBlocked: true,
    hydrationReady: false,
    currentCount: 0,
    priorCount: 5,
  });
  assert.deepEqual(d, { run: false, reason: 'sync-disabled' });
});

test('empty and unchanged state does not sync', () => {
  const d = shouldRunSurveyMarkerSync({ ...READY_BASE, currentCount: 0, priorCount: 0 });
  assert.deepEqual(d, { run: false, reason: 'empty-unchanged' });
});

test('pending hydrate with a NON-empty local state still syncs — the guard only blocks the empty case', () => {
  const d = shouldRunSurveyMarkerSync({
    ...READY_BASE,
    hydrationReady: false,
    currentCount: 3,
    priorCount: 5,
  });
  assert.deepEqual(d, { run: true, reason: 'changed-or-delete-after-hydrate' });
});

test('post-hydrate full delete carries the changed-or-delete-after-hydrate reason', () => {
  const d = shouldRunSurveyMarkerSync({
    ...READY_BASE,
    currentCount: 0,
    priorCount: 2,
    hydrationReady: true,
  });
  assert.deepEqual(d, { run: true, reason: 'changed-or-delete-after-hydrate' });
});

test('no-args call is sync-disabled (every prerequisite defaults false)', () => {
  const d = shouldRunSurveyMarkerSync();
  assert.deepEqual(d, { run: false, reason: 'sync-disabled' });
});
