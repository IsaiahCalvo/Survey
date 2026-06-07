// Stage 0 safety contract — the durable-store origin guard.
//
// Proves the fix for the corruption bug: an Excel-import reconcile of the
// survey-marker Y.Map must be ADDITIVE/patch-only — it may add or update markers
// but must NEVER delete a key just because the imported dict omits it. Only a
// local (app-origin) reconcile deletes missing keys, and even then an explicit
// `protectedIds` set (app-created-not-yet-exported markers) is never deleted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  docToSurveyMarkers,
  syncSurveyMarkersToDoc,
} from '../src/services/annotationDocStore.js';

const marker = (name, page = 1) => ({ name, pageNumber: page, bounds: { x: 1, y: 2, w: 3, h: 4 } });

test('excel-import reconcile is additive: a marker absent from the import is NOT deleted', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { sm1: marker('A'), sm2: marker('B') }, { origin: 'local' });

  // Excel sheet only knows about sm1 (sm2 was placed in the app, never exported).
  const res = syncSurveyMarkersToDoc(doc, { sm1: marker('A') }, { origin: 'excel-import' });

  const out = docToSurveyMarkers(doc);
  assert.ok(out.sm1, 'sm1 still present');
  assert.ok(out.sm2, 'sm2 must survive an excel-import that omits it');
  assert.equal(res.removed, 0, 'excel-import never removes keys');
});

test('local reconcile still deletes missing keys (unchanged behavior)', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { sm1: marker('A'), sm2: marker('B') }, { origin: 'local' });

  const res = syncSurveyMarkersToDoc(doc, { sm1: marker('A') }, { origin: 'local' });

  const out = docToSurveyMarkers(doc);
  assert.ok(out.sm1, 'sm1 still present');
  assert.equal(out.sm2, undefined, 'local reconcile deletes the omitted marker');
  assert.equal(res.removed, 1);
});

test('protectedIds are never deleted even on a local reconcile', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { sm1: marker('A'), sm2: marker('B') }, { origin: 'local' });

  const res = syncSurveyMarkersToDoc(doc, { sm1: marker('A') }, { origin: 'local', protectedIds: ['sm2'] });

  const out = docToSurveyMarkers(doc);
  assert.ok(out.sm2, 'sm2 is protected (app-created, not yet exported)');
  assert.equal(res.removed, 0);
});

test('excel-import still adds and updates markers', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { sm1: marker('A') }, { origin: 'local' });

  const res = syncSurveyMarkersToDoc(
    doc,
    { sm1: marker('A-renamed'), sm2: marker('B') },
    { origin: 'excel-import' },
  );

  const out = docToSurveyMarkers(doc);
  assert.equal(out.sm1.name, 'A-renamed', 'attribute update applied');
  assert.ok(out.sm2, 'new marker from Excel added');
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.removed, 0);
});
