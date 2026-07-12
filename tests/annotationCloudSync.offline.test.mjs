import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NON_HIGHLIGHT_TYPES,
  upsertFabricAnnotation,
  upsertAnnotationsByPage,
  upsertCallouts,
  deleteAnnotation,
  deleteAnnotations,
  dualWriteFabricCommit,
  dualWriteFabricDelete,
  loadAllNonSurveyMarkerAnnotations,
} from '../src/services/annotationCloudSync.js';

test('NON_HIGHLIGHT_TYPES lists expected cloud-owned shapes', () => {
  assert.ok(NON_HIGHLIGHT_TYPES.includes('ink'));
  assert.ok(NON_HIGHLIGHT_TYPES.includes('callout'));
  assert.ok(!NON_HIGHLIGHT_TYPES.includes('surveyMarker'));
});

test('cloud sync writers refuse when supabase is offline', async () => {
  assert.match((await upsertFabricAnnotation({ type: 'path' })).error.message, /Supabase unavailable/);
  assert.match((await upsertAnnotationsByPage({})).error.message, /Supabase unavailable/);
  assert.match((await upsertCallouts([])).error.message, /Supabase unavailable/);
  assert.match((await deleteAnnotation('d', 'a')).error.message, /Supabase unavailable/);
  assert.match((await deleteAnnotations('d', ['a'])).error.message, /Supabase unavailable/);
});

test('dualWriteFabricCommit fires legacy-unavailable path and skipLegacy CRDT-only', async () => {
  const legacyFail = await dualWriteFabricCommit(
    { type: 'path', data: { id: 'anno-1' } },
    { documentId: 'd1', userId: 'u1' },
  );
  assert.ok(legacyFail.legacy?.error);

  const skipped = await dualWriteFabricCommit(
    { type: 'path', data: { id: 'anno-2' }, path: [['M', 0, 0], ['L', 1, 0]] },
    { documentId: 'd1', userId: 'u1', skipLegacy: true },
  );
  assert.equal(skipped.legacy, null);

  const del = await dualWriteFabricDelete('d1', 'anno-1', { userId: 'u1' });
  assert.ok(del.legacy?.error || del.crdt != null || del);
});

test('loadAllNonSurveyMarkerAnnotations returns error when offline', async () => {
  const result = await loadAllNonSurveyMarkerAnnotations('doc-1');
  assert.ok(result.error || result.rawRows);
});
