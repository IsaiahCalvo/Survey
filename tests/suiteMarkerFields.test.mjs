// Kal Voe suite fields on Survey Markers (KAL-588): shared id, library links,
// Building / Wing / Floor / Location. Field sync through live editing, copy
// and paste, the row copy, and the Excel guard.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import {
  SUITE_MARKER_FIELDS,
  libraryEntryIdOf,
  suiteFieldsForCopy,
  suiteIdOf,
} from '../src/survey/suiteMarkerFields.js';
import { buildPastedSurveyMarker, surveyMarkerClipboardEntry } from '../src/utils/surveyMarkerFamily.js';
import { planSurveyMarkerTransfer } from '../src/utils/surveyMarkerTransfer.js';
import { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { forceUnplacedImportedMarker, freezeGeometryFromOriginal } from '../src/services/importFieldWhitelist.js';
import { applyExcelValuesToMarker } from '../src/services/excelConflictResolve.js';
import { __test as excelSync } from '../src/services/excelSyncClient.js';
import { docToSurveyMarkers, syncSurveyMarkersToDoc } from '../src/services/annotationDocStore.js';

const PLACE = { building: 'HP 20', wing: 'East', floor: '1', location: 'Parking lot' };
const marker = (extra = {}) => ({
  id: 'surveyMarker-a',
  pageNumber: 2,
  bounds: { x: 10, y: 20, width: 30, height: 30 },
  moduleId: 'm-install',
  categoryId: 'c-cam',
  name: 'Camera 1',
  entityId: 'e1',
  checklistResponses: { i1: { selection: 'Yes' } },
  ...extra,
});

test('suite id: a marker made in Survey uses its own id; one that arrived keeps its own', () => {
  assert.equal(suiteIdOf({ id: 'surveyMarker-a' }), 'surveyMarker-a');
  assert.equal(suiteIdOf({}, 'surveyMarker-b'), 'surveyMarker-b');
  assert.equal(suiteIdOf({ id: 'surveyMarker-c', suiteId: 'walkthru-node-9' }), 'walkthru-node-9');
  assert.deepEqual(SUITE_MARKER_FIELDS, ['suiteId', 'libraryEntryId', 'libraryTypeEntryId', 'building', 'wing', 'floor', 'location']);
});

test('suite id: copy and paste keeps the shared id, links and place', () => {
  const source = marker({ libraryEntryId: 'lib-cam', ...PLACE });
  const entry = surveyMarkerClipboardEntry(source, 'surveyMarker-a');
  const pasted = buildPastedSurveyMarker(entry, { id: 'surveyMarker-copy', pageNumber: 3, dx: 5, dy: 5, moduleId: 'm-install', categoryId: 'c-cam', suite: true });
  assert.equal(pasted.id, 'surveyMarker-copy');
  assert.equal(pasted.suiteId, 'surveyMarker-a', 'the copy is the same real device');
  assert.equal(pasted.libraryEntryId, 'lib-cam');
  assert.deepEqual({ building: pasted.building, wing: pasted.wing, floor: pasted.floor, location: pasted.location }, PLACE);
  // A copy of the copy still points at the first one.
  const again = buildPastedSurveyMarker(surveyMarkerClipboardEntry(pasted, pasted.id), { id: 'surveyMarker-copy2', pageNumber: 3, suite: true });
  assert.equal(again.suiteId, 'surveyMarker-a');
});

test('suite id: with the suite flag off, a paste is made as before', () => {
  const entry = surveyMarkerClipboardEntry(marker({ ...PLACE }), 'surveyMarker-a');
  const pasted = buildPastedSurveyMarker(entry, { id: 'surveyMarker-copy', pageNumber: 3, suite: false });
  for (const field of SUITE_MARKER_FIELDS) assert.equal(pasted[field], undefined, field);
});

test('suite id: copy to another Module keeps the shared id; move keeps the record', () => {
  const markers = { 'surveyMarker-a': marker({ ...PLACE }) };
  const copy = planSurveyMarkerTransfer({ mode: 'copy', markers, ids: ['surveyMarker-a'], moduleId: 'm-comm', categoryId: 'c-cam2', mintId: () => 'surveyMarker-new', suite: true });
  assert.equal(copy.ok, true);
  assert.equal(copy.changes[0].after.suiteId, 'surveyMarker-a');
  assert.equal(copy.changes[0].after.floor, '1');
  const move = planSurveyMarkerTransfer({ mode: 'move', markers, ids: ['surveyMarker-a'], moduleId: 'm-comm', categoryId: 'c-cam2' });
  assert.equal(suiteIdOf(move.changes[0].after, move.changes[0].id), 'surveyMarker-a');
});

test('suite fields: survive the row copy and a reload; markers without them read as before', () => {
  const local = marker({ suiteId: 'walkthru-node-9', libraryEntryId: 'lib-cam', libraryTypeEntryId: 'lib-ptz', ...PLACE });
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'surveyMarker-a', annotation: local });
  assert.equal(row.annotation_data.suiteId, 'walkthru-node-9');
  assert.equal(row.annotation_data.location, 'Parking lot');
  const back = mapSurveyMarkerRowToLocalAnnotation({ ...row, id: 'row-1' });
  for (const field of SUITE_MARKER_FIELDS) assert.equal(back[field], local[field], field);

  const plain = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: 'surveyMarker-b', annotation: marker() });
  for (const field of SUITE_MARKER_FIELDS) assert.equal(plain.annotation_data[field], undefined, field);
  const plainBack = mapSurveyMarkerRowToLocalAnnotation({ ...plain, id: 'row-2' });
  for (const field of SUITE_MARKER_FIELDS) assert.equal(plainBack[field], undefined, field);
  assert.equal(suiteIdOf(plainBack), 'surveyMarker-b');
});

for (const fieldMaps of [false, true]) {
  test(`suite fields: sync through live editing and offline edits merge (fieldMaps=${fieldMaps})`, () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    syncSurveyMarkersToDoc(a, { 'surveyMarker-a': marker({ suiteId: 'walkthru-node-9', ...PLACE }) }, { fieldMaps });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    assert.equal(docToSurveyMarkers(b)['surveyMarker-a'].suiteId, 'walkthru-node-9');
    assert.equal(docToSurveyMarkers(b)['surveyMarker-a'].building, 'HP 20');

    // Two devices edit while apart: one sets the Location, the other renames.
    const onA = docToSurveyMarkers(a)['surveyMarker-a'];
    syncSurveyMarkersToDoc(a, { 'surveyMarker-a': { ...onA, location: 'Kitchen' } }, { fieldMaps });
    const onB = docToSurveyMarkers(b)['surveyMarker-a'];
    syncSurveyMarkersToDoc(b, { 'surveyMarker-a': { ...onB, name: 'Camera 101' } }, { fieldMaps });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const merged = docToSurveyMarkers(a)['surveyMarker-a'];
    assert.deepEqual(docToSurveyMarkers(b)['surveyMarker-a'], merged);
    assert.equal(merged.suiteId, 'walkthru-node-9');
    if (fieldMaps) {
      assert.equal(merged.location, 'Kitchen');
      assert.equal(merged.name, 'Camera 101');
    }

    // A reload from the saved state keeps every field.
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(a));
    assert.deepEqual(docToSurveyMarkers(reloaded)['surveyMarker-a'], merged);
  });
}

test('Excel guard: a workbook that edits the suite id column is refused for that column', () => {
  const original = marker({ suiteId: 'walkthru-node-9', ...PLACE });
  // The import path: whatever the row wrote, the marker's own suite fields come back.
  const candidate = { ...original, name: 'Camera 1A', suiteId: 'typed-in-excel', floor: '9', location: 'Roof' };
  const saved = freezeGeometryFromOriginal(candidate, original);
  assert.equal(saved.name, 'Camera 1A', 'the rest of the row still lands');
  assert.equal(saved.suiteId, 'walkthru-node-9');
  assert.equal(saved.floor, '1');
  assert.equal(saved.location, 'Parking lot');

  // A marker with no stored suite id gets none from the sheet.
  const plain = freezeGeometryFromOriginal({ ...marker(), suiteId: 'typed-in-excel' }, marker());
  assert.equal(plain.suiteId, undefined);
  assert.equal(suiteIdOf(plain), 'surveyMarker-a');

  // A new row made from the workbook carries no suite field from it.
  const made = forceUnplacedImportedMarker({ id: 'surveyMarker-new', name: 'X', suiteId: 'typed-in-excel', building: 'B' });
  assert.equal(made.suiteId, undefined);
  assert.equal(made.building, undefined);
  assert.equal(suiteIdOf(made), 'surveyMarker-new');

  // "Use Excel's version" and the cloud Excel sync write only their own columns.
  const viaConflict = applyExcelValuesToMarker(original, { item: 'Camera 1B', suiteId: 'typed-in-excel', floor: '9' });
  assert.equal(viaConflict.suiteId, 'walkthru-node-9');
  assert.equal(viaConflict.floor, '1');
  const viaCloud = excelSync.overlayChangedFields(JSON.parse(JSON.stringify(original)), {
    opType: 'update', changedFieldKeys: ['item', 'suiteId', 'floor'], fields: { item: 'Camera 1C', suiteId: 'typed-in-excel', floor: '9' },
  });
  assert.equal(viaCloud.name, 'Camera 1C');
  assert.equal(viaCloud.suiteId, 'walkthru-node-9');
  assert.equal(viaCloud.floor, '1');
});

test('library link: a marker reads its Category link from the template when it has none', () => {
  const template = { modules: [
    { id: 'm-install', categories: [{ id: 'c-cam', name: 'Cameras', libraryEntryId: 'lib-cam' }] },
  ] };
  assert.equal(libraryEntryIdOf(marker(), template), 'lib-cam');
  assert.equal(libraryEntryIdOf(marker({ libraryEntryId: 'lib-own' }), template), 'lib-own');
  assert.equal(libraryEntryIdOf(marker({ categoryId: 'c-none' }), template), null);
  assert.deepEqual(suiteFieldsForCopy(marker()), { suiteId: 'surveyMarker-a' });
});
