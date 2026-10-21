// The shared survey-marker module must load with no DOM/browser globals and no
// imports, so the survey-mcp Deno edge function can use it as-is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import * as shared from '../supabase/functions/_shared/surveyMarkerDocSync.js';
import * as store from '../src/services/annotationDocStore.js';

test('shared module has no imports and no browser globals', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const src = readFileSync(new URL('../supabase/functions/_shared/surveyMarkerDocSync.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\b(window|localStorage|indexedDB|import\.meta)\b/);
});

test('annotationDocStore re-exports the same bindings', () => {
  for (const k of ['SURVEY_MARKERS_MAP', 'getSurveyMarkersMap', 'docToSurveyMarkers', 'syncSurveyMarkersToDoc']) {
    assert.equal(store[k], shared[k], k);
  }
  assert.equal(shared.SURVEY_MARKERS_MAP, 'surveyMarkers');
});

test('sync round-trips, is idempotent, and excel-import never deletes', () => {
  const doc = new Y.Doc();
  const a = { page: 1, bounds: { x: 1, y: 2 } };
  assert.deepEqual(shared.syncSurveyMarkersToDoc(doc, { a, b: { page: 2 } }), { added: 2, updated: 0, removed: 0 });
  assert.deepEqual(shared.docToSurveyMarkers(doc).a, a);
  assert.deepEqual(shared.syncSurveyMarkersToDoc(doc, { a: { bounds: { y: 2, x: 1 }, page: 1 }, b: { page: 2 } }), { added: 0, updated: 0, removed: 0 });
  assert.deepEqual(shared.syncSurveyMarkersToDoc(doc, { a }, { origin: 'excel-import' }), { added: 0, updated: 0, removed: 0 });
  assert.deepEqual(shared.syncSurveyMarkersToDoc(doc, { a }), { added: 0, updated: 0, removed: 1 });
});
