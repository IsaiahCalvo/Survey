import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  initializeSurveyCrdtV2,
  materializeSurveyCrdtV2,
  SURVEY_V2_ROOTS,
  updateSurveyMarkersV2,
  updateSurveySpacesV2,
} from '../src/services/documentSurveyCrdtV2.js';

const uuid = number => `91000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

function setup() {
  let nextId = 0;
  const createId = () => uuid(++nextId);
  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, {
    surveyMarkers: { marker: { annotationId: 'marker', pageNumber: 1,
      bounds: { x: 1, y: 2, width: 3, height: 4 }, checklistResponses: { check: { selection: 'Y' } } } },
    spaces: [{ id: 'space', name: 'Space', assignedPages: [{ pageId: 1,
      regions: [{ regionId: 'region', name: 'Region', bounds: { x: 1, y: 2, width: 3, height: 4 } }] }] }],
    createId,
  });
  return { doc, createId, getCreated: () => nextId };
}

test('canonical no-op validates fully without IDs or Yjs updates and returns frozen state', () => {
  const { doc, createId, getCreated } = setup();
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const beforeIds = getCreated();
  const markerResult = updateSurveyMarkersV2(doc, markers => markers, { createId });
  const spaceResult = updateSurveySpacesV2(doc, spaces => spaces, { createId });
  assert.equal(markerResult.changed, false);
  assert.equal(spaceResult.changed, false);
  assert.equal(updates, 0);
  assert.equal(getCreated(), beforeIds);
  assert.ok(Object.isFrozen(markerResult));
  assert.ok(Object.isFrozen(markerResult.surveyMarkers.marker.checklistResponses));
  assert.ok(Object.isFrozen(spaceResult.spaces[0].assignedPages[0].regions[0]));
  doc.destroy();
});

test('no-op updates retain malformed input errors and atomic zero-write behavior', () => {
  const { doc, createId } = setup();
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(() => updateSurveyMarkersV2(doc, { marker: cyclic }, { createId }),
    { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.throws(() => updateSurveySpacesV2(doc, [
    { id: 'same', assignedPages: [] }, { id: 'same', assignedPages: [] },
  ], { createId }), { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.throws(() => updateSurveySpacesV2(doc, [{ id: 'space', assignedPages: [
    { pageId: 1, regions: [] }, { pageId: 1, regions: [] },
  ] }], { createId }), { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.throws(() => updateSurveySpacesV2(doc, [{ id: 'space', assignedPages: [
    { pageId: 1, regions: [{ regionId: 'same' }, { regionId: 'same' }] },
  ] }], { createId }), { code: 'SURVEY_CRDT_V2_INVALID' });
  let getterCalls = 0;
  const accessorMarker = {};
  Object.defineProperty(accessorMarker, 'annotationId', {
    enumerable: true,
    get() { getterCalls += 1; return 'marker'; },
  });
  assert.throws(() => updateSurveyMarkersV2(doc, { marker: accessorMarker }, { createId }),
    { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.equal(getterCalls, 0);
  assert.equal(updates, 0);
  doc.destroy();
});

test('updater input and returned state stay isolated from later caller mutation', () => {
  const { doc, createId } = setup();
  let updaterInput;
  const result = updateSurveyMarkersV2(doc, markers => {
    updaterInput = markers;
    markers.marker.entityName = 'Accepted clone';
    return markers;
  }, { createId });
  updaterInput.marker.entityName = 'Late caller mutation';
  updaterInput.marker.checklistResponses.check.selection = 'N';
  const stored = materializeSurveyCrdtV2(doc).surveyMarkers.marker;
  assert.equal(result.surveyMarkers.marker.entityName, 'Accepted clone');
  assert.equal(stored.entityName, 'Accepted clone');
  assert.equal(stored.checklistResponses.check.selection, 'Y');
  doc.destroy();
});

test('malformed remote storage fails before a would-be no-op updater or write', () => {
  const { doc, createId } = setup();
  const groups = doc.getMap(SURVEY_V2_ROOTS.markerGroups);
  const [groupKey] = groups.keys();
  doc.transact(() => groups.set(groupKey, { json: { malformed: true } }), 'remote');
  let updates = 0;
  let updaterCalls = 0;
  doc.on('update', () => { updates += 1; });
  assert.throws(() => updateSurveyMarkersV2(doc, markers => {
    updaterCalls += 1;
    return markers;
  }, { createId }), { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.equal(updaterCalls, 0);
  assert.equal(updates, 0);
  doc.destroy();
});

test('would-be space no-op repairs noncanonical live order values once', () => {
  const corruptions = [
    { label: 'malformed root', key: () => 'spaces', value: { bad: true } },
    { label: 'duplicate root', key: () => 'spaces', value: ['space', 'space'] },
    { label: 'stale root', key: () => 'spaces', value: ['stale', 'space'] },
    { label: 'missing root', key: () => 'spaces', remove: true },
    { label: 'malformed page order', key: doc => {
      const life = doc.getMap(SURVEY_V2_ROOTS.spaceLifecycle).get('space');
      return JSON.stringify(['pages', 'space', life.incarnationId]);
    }, value: { bad: true } },
    { label: 'duplicate region order', key: doc => {
      const spaceLife = doc.getMap(SURVEY_V2_ROOTS.spaceLifecycle).get('space');
      const pageKey = JSON.stringify(['space', spaceLife.incarnationId, '1']);
      const pageLife = doc.getMap(SURVEY_V2_ROOTS.pageLifecycle).get(pageKey);
      return JSON.stringify(['regions', 'space', spaceLife.incarnationId, '1', pageLife.incarnationId]);
    }, value: ['region', 'region'] },
  ];
  for (const corruption of corruptions) {
    const { doc, createId } = setup();
    const orders = doc.getMap(SURVEY_V2_ROOTS.orders);
    const key = corruption.key(doc);
    doc.transact(() => {
      if (corruption.remove) orders.delete(key);
      else orders.set(key, corruption.value);
    }, 'remote');
    let updates = 0;
    doc.on('update', () => { updates += 1; });
    const repaired = updateSurveySpacesV2(doc, spaces => spaces, { createId });
    assert.equal(repaired.changed, true, corruption.label);
    assert.equal(updates, 1, corruption.label);
    updates = 0;
    const noOp = updateSurveySpacesV2(doc, spaces => spaces, { createId });
    assert.equal(noOp.changed, false, corruption.label);
    assert.equal(updates, 0, corruption.label);
    doc.destroy();
  }
});

test('no-op reads fresh peer state and changed updates still transact', () => {
  const local = setup();
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(local.doc));
  const baseline = Y.encodeStateVector(peer);
  updateSurveyMarkersV2(peer, markers => ({ ...markers,
    marker: { ...markers.marker, entityName: 'Remote name' },
  }), { createId: () => uuid(999) });
  Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(peer, baseline), 'remote');

  let updates = 0;
  local.doc.on('update', () => { updates += 1; });
  const noOp = updateSurveyMarkersV2(local.doc, markers => markers, { createId: local.createId });
  assert.equal(noOp.changed, false);
  assert.equal(noOp.surveyMarkers.marker.entityName, 'Remote name');
  assert.equal(updates, 0);

  const changed = updateSurveySpacesV2(local.doc, spaces => spaces.map(space => (
    { ...space, name: 'Changed space' }
  )), { createId: local.createId });
  assert.equal(changed.changed, true);
  assert.equal(changed.spaces[0].name, 'Changed space');
  assert.ok(updates > 0);
  local.doc.destroy();
  peer.destroy();
});
