// Kal Voe suite fields on Survey Markers (KAL-588): a shared suite id (its
// own id when made in Survey, kept on copy and paste), library links and
// Building / Wing / Floor / Location. They sync through live editing, survive
// the row copy and reload, never come from Excel, and markers without them
// keep working.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  nextSuitePlaces,
  readSuiteId,
  readSuitePlaces,
  suiteFieldsForCopy,
  suiteFieldsFromRow,
  suiteRowData,
} from '../src/suite/suiteFields.js';
import { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { buildPastedSurveyMarker, surveyMarkerClipboardEntry } from '../src/utils/surveyMarkerFamily.js';
import { forceUnplacedImportedMarker, freezeGeometryFromOriginal } from '../src/services/importFieldWhitelist.js';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../supabase/functions/_shared/surveyMarkerDocSync.js';
import { computeExcelSyncFingerprint } from '../src/utils/excelSyncDirtyState.js';

const marker = (extra = {}) => ({
  pageNumber: 1,
  bounds: { x: 10, y: 20, width: 30, height: 40 },
  categoryId: 'cat-cam',
  moduleId: 'mod-install',
  name: 'C-1-01',
  entityId: 'gc',
  checklistResponses: { q1: 'Yes' },
  ...extra,
});

test('a marker made in Survey takes its own id as its suite id', () => {
  assert.equal(readSuiteId(marker(), 'surveyMarker-a'), 'surveyMarker-a');
  assert.equal(readSuiteId(marker({ suiteId: 'wt-node-7' }), 'surveyMarker-a'), 'wt-node-7');
  assert.equal(readSuiteId({}, null), null);
});

test('place edits clean the text and drop emptied fields', () => {
  const m = marker();
  const a = nextSuitePlaces(m, { building: '  HP 20 ', floor: '4' });
  assert.notEqual(a, m);
  assert.deepEqual(readSuitePlaces(a), { building: 'HP 20', wing: '', floor: '4', location: '' });
  assert.equal(nextSuitePlaces(a, { building: 'HP 20' }), a, 'no change, same object');
  const b = nextSuitePlaces(a, { floor: '   ' });
  assert.equal('floor' in b, false);
  assert.equal(nextSuitePlaces(a, { location: 'x'.repeat(500) }).location.length, 120);
});

test('copy and paste keeps the suite id, library links and places', () => {
  const source = marker({ building: 'HP 20', wing: 'East', floor: '4', location: 'Lobby', libraryEntryId: 'lib-cam' });
  const entry = surveyMarkerClipboardEntry(source, { id: 'surveyMarker-a', suite: true });
  assert.deepEqual(entry.suite, suiteFieldsForCopy(source, 'surveyMarker-a'));
  const pasted = buildPastedSurveyMarker(entry, { id: 'surveyMarker-b', pageNumber: 2, categoryId: 'cat-cam', moduleId: 'mod-commission' });
  assert.equal(readSuiteId(pasted, 'surveyMarker-b'), 'surveyMarker-a');
  assert.equal(pasted.libraryEntryId, 'lib-cam');
  assert.deepEqual(readSuitePlaces(pasted), { building: 'HP 20', wing: 'East', floor: '4', location: 'Lobby' });
  // A copy of a copy still points at the first device.
  const again = buildPastedSurveyMarker(surveyMarkerClipboardEntry(pasted, { id: 'surveyMarker-b', suite: true }), { id: 'surveyMarker-c', categoryId: 'cat-cam' });
  assert.equal(readSuiteId(again, 'surveyMarker-c'), 'surveyMarker-a');
});

test('flag off: a copy carries only suite fields the marker already stores', () => {
  const plain = surveyMarkerClipboardEntry(marker(), { id: 'surveyMarker-a', suite: false });
  assert.equal(plain.suite, undefined);
  const pasted = buildPastedSurveyMarker(plain, { id: 'surveyMarker-b', categoryId: 'cat-cam' });
  assert.equal(readSuiteId(pasted, 'surveyMarker-b'), 'surveyMarker-b');
  const stored = surveyMarkerClipboardEntry(marker({ suiteId: 'wt-1', floor: '2' }), { id: 'surveyMarker-a', suite: false });
  assert.deepEqual(stored.suite, { suiteId: 'wt-1', floor: '2' });
});

test('the row copy carries the suite fields and reload brings them back', () => {
  const local = marker({ building: 'HP 30', location: 'IDF 2', suiteId: 'plot-dev-9' });
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'surveyMarker-a', annotation: local, suite: true });
  assert.deepEqual(row.annotation_data.suite, { suiteId: 'plot-dev-9', building: 'HP 30', location: 'IDF 2' });
  const back = mapSurveyMarkerRowToLocalAnnotation({ ...row, id: 1, updated_at: 'now' });
  assert.equal(back.suiteId, 'plot-dev-9');
  assert.equal(back.building, 'HP 30');
  assert.equal(back.location, 'IDF 2');

  // Own id: the row names it, the local record does not need to store it.
  const own = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'surveyMarker-b', annotation: marker(), suite: true });
  assert.deepEqual(own.annotation_data.suite, { suiteId: 'surveyMarker-b' });
  const ownBack = mapSurveyMarkerRowToLocalAnnotation({ ...own, id: 2 });
  assert.equal('suiteId' in ownBack, false);
  assert.equal(readSuiteId(ownBack, 'surveyMarker-b'), 'surveyMarker-b');
  assert.deepEqual(suiteFieldsFromRow(suiteRowData(marker(), 'x'), 'x'), {});
});

test('existing markers without the fields keep working (flag off writes no suite data)', () => {
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'surveyMarker-a', annotation: marker(), suite: false });
  assert.equal('suite' in row.annotation_data, false);
  const back = mapSurveyMarkerRowToLocalAnnotation({ ...row, id: 1 });
  for (const field of ['suiteId', 'building', 'wing', 'floor', 'location', 'libraryEntryId']) assert.equal(field in back, false, field);
  assert.equal(back.name, 'C-1-01');
  // A marker that stores a place keeps it even with the flag off.
  const kept = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'surveyMarker-a', annotation: marker({ floor: '3' }), suite: false });
  assert.deepEqual(kept.annotation_data.suite, { floor: '3', suiteId: 'surveyMarker-a' });
});

test('live editing: the fields sync through the Yjs doc, and two screens editing different fields both land', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u, origin) => { if (origin !== 'remote') Y.applyUpdate(b, u, 'remote'); });
  b.on('update', (u, origin) => { if (origin !== 'remote') Y.applyUpdate(a, u, 'remote'); });
  syncSurveyMarkersToDoc(a, { m1: marker({ suiteId: 'wt-1' }) }, { fieldMaps: true });
  assert.equal(docToSurveyMarkers(b).m1.suiteId, 'wt-1');
  // Offline on both, then reconnect.
  const offA = new Y.Doc(); Y.applyUpdate(offA, Y.encodeStateAsUpdate(a));
  const offB = new Y.Doc(); Y.applyUpdate(offB, Y.encodeStateAsUpdate(b));
  syncSurveyMarkersToDoc(offA, { m1: { ...docToSurveyMarkers(offA).m1, building: 'HP 20' } }, { fieldMaps: true });
  syncSurveyMarkersToDoc(offB, { m1: { ...docToSurveyMarkers(offB).m1, location: 'Lobby' } }, { fieldMaps: true });
  Y.applyUpdate(offA, Y.encodeStateAsUpdate(offB));
  Y.applyUpdate(offB, Y.encodeStateAsUpdate(offA));
  for (const doc of [offA, offB]) {
    const m1 = docToSurveyMarkers(doc).m1;
    assert.equal(m1.building, 'HP 20');
    assert.equal(m1.location, 'Lobby');
    assert.equal(m1.suiteId, 'wt-1');
  }
});

test('Excel guard: a workbook can never change or set the suite id', () => {
  // Client import paths.
  const original = marker({ suiteId: 'wt-1' });
  const candidate = { ...original, suiteId: 'hacked', name: 'C-1-02' };
  const safe = freezeGeometryFromOriginal(candidate, original);
  assert.equal(safe.suiteId, 'wt-1');
  assert.equal(safe.name, 'C-1-02');
  assert.equal('suiteId' in freezeGeometryFromOriginal({ ...marker(), suiteId: 'x' }, marker()), false);
  assert.equal('suiteId' in forceUnplacedImportedMarker({ name: 'new', suiteId: 'x' }), false);

  // Sheet sync / any excel-import write into the doc.
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: original, m2: marker() });
  syncSurveyMarkersToDoc(doc, {
    m1: { ...original, suiteId: 'hacked', name: 'C-1-09' },
    m2: { ...marker(), suiteId: 'hacked' },
    m3: { ...marker(), suiteId: 'hacked' },
  }, { origin: 'excel-import' });
  const out = docToSurveyMarkers(doc);
  assert.equal(out.m1.suiteId, 'wt-1');
  assert.equal(out.m1.name, 'C-1-09', 'the other fields of that row still land');
  assert.equal('suiteId' in out.m2, false);
  assert.equal('suiteId' in out.m3, false);
  // Dropping the id from a sheet row cannot clear it either.
  const { suiteId: _drop, ...noId } = original;
  syncSurveyMarkersToDoc(doc, { m1: noId }, { origin: 'excel-import' });
  assert.equal(docToSurveyMarkers(doc).m1.suiteId, 'wt-1');
  // The app itself can still write it.
  syncSurveyMarkersToDoc(doc, { ...docToSurveyMarkers(doc), m2: { ...out.m2, suiteId: 'plot-1' } });
  assert.equal(docToSurveyMarkers(doc).m2.suiteId, 'plot-1');
});

test('place edits do not make a linked workbook read "not synced"', () => {
  const tpl = { id: 't' };
  const before = computeExcelSyncFingerprint(tpl, { m1: marker() });
  const after = computeExcelSyncFingerprint(tpl, { m1: marker({ building: 'HP 20', suiteId: 'wt-1' }) });
  assert.deepEqual(after, before);
});
