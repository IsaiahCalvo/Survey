import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRunSurveyMarkerSync } from '../src/utils/surveyMarkerSyncSafety.js';

test('shouldRunSurveyMarkerSync blocks when sync prerequisites are missing', () => {
  assert.deepEqual(shouldRunSurveyMarkerSync({}), {
    run: false,
    reason: 'sync-disabled',
  });
  assert.deepEqual(shouldRunSurveyMarkerSync({
    documentSyncEnabled: true,
    hasDocumentId: true,
    hasUserId: true,
    syncBlocked: true,
  }), { run: false, reason: 'sync-disabled' });
});

test('shouldRunSurveyMarkerSync blocks empty hydrate deletes and empty no-ops', () => {
  assert.deepEqual(shouldRunSurveyMarkerSync({
    documentSyncEnabled: true,
    hasDocumentId: true,
    hasUserId: true,
    hydrationReady: false,
    currentCount: 0,
    priorCount: 3,
  }), { run: false, reason: 'hydrate-empty-delete-guard' });

  assert.deepEqual(shouldRunSurveyMarkerSync({
    documentSyncEnabled: true,
    hasDocumentId: true,
    hasUserId: true,
    currentCount: 0,
    priorCount: 0,
  }), { run: false, reason: 'empty-unchanged' });
});

test('shouldRunSurveyMarkerSync allows changed or delete-after-hydrate syncs', () => {
  assert.deepEqual(shouldRunSurveyMarkerSync({
    documentSyncEnabled: true,
    hasDocumentId: true,
    hasUserId: true,
    currentCount: 2,
    priorCount: 1,
  }), { run: true, reason: 'changed-or-delete-after-hydrate' });
});
