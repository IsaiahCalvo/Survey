import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  docToSurveyMarkers,
  getSurveyMarkersMap,
  readSurveyMarkerValue,
  syncSurveyMarkersToDoc,
} from '../supabase/functions/_shared/surveyMarkerDocSync.js';

const base = { id: 'm1', name: 'Door', notes: '', categoryId: 'c1', bounds: { x: 1, y: 2, width: 3, height: 4 } };

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  return { a, b };
}
const sync = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));

function concurrentFieldEdits(fieldMaps) {
  const { a, b } = pair();
  syncSurveyMarkersToDoc(a, { m1: base }, { fieldMaps });
  sync(a, b);
  // Both edit before either sees the other.
  syncSurveyMarkersToDoc(a, { m1: { ...base, name: 'Fire door' } }, { fieldMaps });
  syncSurveyMarkersToDoc(b, { m1: { ...base, notes: 'check closer' } }, { fieldMaps });
  sync(a, b);
  sync(b, a);
  return { a: docToSurveyMarkers(a).m1, b: docToSurveyMarkers(b).m1 };
}

test('field maps: concurrent edits to different fields of one marker both survive', () => {
  const { a, b } = concurrentFieldEdits(true);
  assert.deepEqual(a, b);
  assert.equal(a.name, 'Fire door');
  assert.equal(a.notes, 'check closer');
});

test('flag off (whole values): one of two concurrent field edits is lost, as today', () => {
  const { a, b } = concurrentFieldEdits(false);
  assert.deepEqual(a, b);
  const kept = [a.name === 'Fire door', a.notes === 'check closer'].filter(Boolean).length;
  assert.equal(kept, 1);
});

test('old-shape docs read the same, and a field-map write upgrades the marker', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: base }); // plain object
  assert.deepEqual(docToSurveyMarkers(doc), { m1: base });
  assert.ok(!(getSurveyMarkersMap(doc).get('m1') instanceof Y.Map));

  // Unchanged re-apply with field maps: no upgrade, zero updates.
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  assert.deepEqual(syncSurveyMarkersToDoc(doc, { m1: base }, { fieldMaps: true }), { added: 0, updated: 0, removed: 0 });
  assert.equal(updates, 0);

  syncSurveyMarkersToDoc(doc, { m1: { ...base, name: 'Window' } }, { fieldMaps: true });
  assert.ok(getSurveyMarkersMap(doc).get('m1') instanceof Y.Map);
  assert.deepEqual(docToSurveyMarkers(doc), { m1: { ...base, name: 'Window' } });
});

test('field-map markers read back with the flag off, and re-apply is a no-op', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: base }, { fieldMaps: true });
  assert.ok(getSurveyMarkersMap(doc).get('m1') instanceof Y.Map);
  assert.deepEqual(docToSurveyMarkers(doc), { m1: base });
  assert.deepEqual(readSurveyMarkerValue(getSurveyMarkersMap(doc).get('m1')), base);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  syncSurveyMarkersToDoc(doc, { m1: base }); // flag-off writer, same marker
  syncSurveyMarkersToDoc(doc, { m1: base }, { fieldMaps: true });
  assert.equal(updates, 0);
  // A flag-off write of a change stores a whole value again (today's shape).
  syncSurveyMarkersToDoc(doc, { m1: { ...base, name: 'Gate' } });
  assert.deepEqual(docToSurveyMarkers(doc).m1.name, 'Gate');
});

test('field maps: a removed field is deleted, only changed fields are written', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: base }, { fieldMaps: true });
  const { notes, ...withoutNotes } = base;
  void notes;
  const fields = getSurveyMarkersMap(doc).get('m1');
  let keys = null;
  fields.observe((event) => { keys = [...event.keysChanged].sort(); });
  syncSurveyMarkersToDoc(doc, { m1: { ...withoutNotes, name: 'X' } }, { fieldMaps: true });
  assert.deepEqual(keys, ['name', 'notes']);
  assert.deepEqual(docToSurveyMarkers(doc).m1, { ...withoutNotes, name: 'X' });
});

test('field maps: deletes and excel-import additivity are unchanged', () => {
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, { m1: base, m2: { ...base, id: 'm2' } }, { fieldMaps: true });
  syncSurveyMarkersToDoc(doc, { m1: base }, { fieldMaps: true, origin: 'excel-import' });
  assert.deepEqual(Object.keys(docToSurveyMarkers(doc)).sort(), ['m1', 'm2']);
  syncSurveyMarkersToDoc(doc, { m1: base }, { fieldMaps: true });
  assert.deepEqual(Object.keys(docToSurveyMarkers(doc)), ['m1']);
});
