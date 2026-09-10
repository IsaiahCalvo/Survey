import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  initializeSurveyCrdtV2,
  materializeSurveyCrdtV2,
  updateSurveyMarkersV2,
  updateSurveySpacesV2,
} from '../src/services/documentSurveyCrdtV2.js';
import { mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';

let nextId = 0;
const createId = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`;
const marker = (extra = {}) => ({
  annotationId: 'marker', pageNumber: 1,
  bounds: { x: 1, y: 2, width: 3, height: 4 },
  checklistResponses: {}, ...extra,
});

function branch(snapshot, clientID) {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, snapshot);
  return doc;
}

function captured(doc, action) {
  const updates = [];
  doc.on('update', update => updates.push(update));
  action();
  return Y.mergeUpdates(updates);
}

test('v2 merges atomic entity assignment with a distinct checklist response', () => {
  const base = new Y.Doc();
  initializeSurveyCrdtV2(base, { surveyMarkers: { marker: marker({
    entityId: 'old', entityName: 'Old', entityColor: '#111111',
    checklistResponses: { existing: { selection: 'Y' } },
  }) }, createId });
  const snapshot = Y.encodeStateAsUpdate(base);
  const a = branch(snapshot, 20);
  const b = branch(snapshot, 30);
  const updateA = captured(a, () => updateSurveyMarkersV2(a, current => ({
    ...current,
    marker: { ...current.marker, entityId: 'new', entityName: 'New', entityColor: '#222222' },
  }), { createId }));
  const updateB = captured(b, () => updateSurveyMarkersV2(b, current => ({
    ...current,
    marker: { ...current.marker, checklistResponses: {
      ...current.marker.checklistResponses, second: { selection: 'N', note: 'check' },
    } },
  }), { createId }));
  for (const updates of [[updateA, updateB], [updateB, updateA]]) {
    const merged = branch(snapshot, 40);
    updates.forEach(update => Y.applyUpdate(merged, update));
    assert.deepEqual(materializeSurveyCrdtV2(merged).surveyMarkers.marker, marker({
      entityId: 'new', entityName: 'New', entityColor: '#222222',
      checklistResponses: {
        existing: { selection: 'Y' }, second: { selection: 'N', note: 'check' },
      },
    }));
  }
});

test('v2 deletion wins over a concurrent edit to the same marker incarnation', () => {
  const base = new Y.Doc();
  initializeSurveyCrdtV2(base, { surveyMarkers: { marker: marker() }, createId });
  const snapshot = Y.encodeStateAsUpdate(base);
  const remove = branch(snapshot, 20);
  const edit = branch(snapshot, 30);
  const removeUpdate = captured(remove, () => updateSurveyMarkersV2(remove, {}, { createId }));
  const editUpdate = captured(edit, () => updateSurveyMarkersV2(edit, current => ({
    marker: { ...current.marker, note: 'late' },
  }), { createId }));
  const merged = branch(snapshot, 40);
  Y.applyUpdate(merged, editUpdate);
  Y.applyUpdate(merged, removeUpdate);
  assert.deepEqual(materializeSurveyCrdtV2(merged).surveyMarkers, {});
});

test('space, page, and region groups merge while removed page stays deleted', () => {
  const sourceSpace = [{ id: 'space', name: 'Base', assignedPages: [{
    pageId: 1, wholePageIncluded: false,
    regions: [{ regionId: 'region', points: [{ x: 1, y: 2 }] }],
  }] }];
  const base = new Y.Doc();
  initializeSurveyCrdtV2(base, { spaces: sourceSpace, createId });
  const snapshot = Y.encodeStateAsUpdate(base);
  const rename = branch(snapshot, 20);
  const region = branch(snapshot, 30);
  const renameUpdate = captured(rename, () => updateSurveySpacesV2(rename,
    current => current.map(space => ({ ...space, name: 'Renamed' })), { createId }));
  const regionUpdate = captured(region, () => updateSurveySpacesV2(region,
    current => current.map(space => ({ ...space, assignedPages: space.assignedPages.map(page => ({
      ...page, regions: page.regions.map(value => ({ ...value, points: [{ x: 9, y: 8 }] })),
    })) })), { createId }));
  const merged = branch(snapshot, 40);
  Y.applyUpdate(merged, renameUpdate);
  Y.applyUpdate(merged, regionUpdate);
  assert.equal(materializeSurveyCrdtV2(merged).spaces[0].name, 'Renamed');
  assert.deepEqual(materializeSurveyCrdtV2(merged).spaces[0].assignedPages[0].regions[0].points,
    [{ x: 9, y: 8 }]);

  const remove = branch(snapshot, 50);
  const removeUpdate = captured(remove, () => updateSurveySpacesV2(remove,
    current => current.map(space => ({ ...space, assignedPages: [] })), { createId }));
  const removed = branch(snapshot, 60);
  Y.applyUpdate(removed, regionUpdate);
  Y.applyUpdate(removed, removeUpdate);
  assert.deepEqual(materializeSurveyCrdtV2(removed).spaces[0].assignedPages, []);
});

test('invalid update and initialization emit no accepted document update', () => {
  const invalidDoc = new Y.Doc();
  let invalidUpdates = 0;
  invalidDoc.on('update', () => { invalidUpdates += 1; });
  assert.throws(() => initializeSurveyCrdtV2(invalidDoc, {
    surveyMarkers: {
      first: marker(),
      second: { annotationId: 'second', pageNumber: 0, bounds: {} },
    },
    createId,
  }), { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.equal(invalidUpdates, 0);
  assert.equal([...invalidDoc.share.values()].reduce((sum, root) => sum + root.size, 0), 0);

  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, { surveyMarkers: { marker: marker() }, createId });
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  assert.throws(() => updateSurveySpacesV2(doc, [
    { id: 'space', assignedPages: [] },
    { id: 'space', assignedPages: [] },
  ], { createId }), { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.equal(updates, 0);
  assert.deepEqual(materializeSurveyCrdtV2(doc).spaces, []);
});

test('missing and empty checklist shape round-trip and cleared groups stay cleared', () => {
  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, { surveyMarkers: {
    missing: { annotationId: 'missing', pageNumber: 1, bounds: {}, entityId: 'e', entityName: 'E' },
    empty: { annotationId: 'empty', pageNumber: 1, bounds: {}, checklistResponses: {} },
  }, createId });
  assert.equal(Object.hasOwn(materializeSurveyCrdtV2(doc).surveyMarkers.missing, 'checklistResponses'), false);
  assert.deepEqual(materializeSurveyCrdtV2(doc).surveyMarkers.empty.checklistResponses, {});
  updateSurveyMarkersV2(doc, current => {
    const next = structuredClone(current);
    delete next.missing.entityId;
    delete next.missing.entityName;
    return next;
  }, { createId });
  assert.equal(materializeSurveyCrdtV2(doc).surveyMarkers.missing.entityId, undefined);
});

test('combined marker and space budget failure commits no v2 roots or update', () => {
  const doc = new Y.Doc();
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  const large = Array(126_000).fill(0);
  assert.throws(() => initializeSurveyCrdtV2(doc, {
    surveyMarkers: { marker: marker({ extension: large }) },
    spaces: [{ id: 'space', assignedPages: [], extension: large }],
    createId,
  }), { code: 'SURVEY_CRDT_V2_INVALID' });
  assert.equal(updates, 0);
  for (const root of doc.share.values()) assert.equal(root.size, 0);
});

test('repeated edits retain one Yjs client identity', () => {
  const doc = new Y.Doc();
  doc.clientID = 9001;
  initializeSurveyCrdtV2(doc, { surveyMarkers: { marker: marker() }, createId });
  for (let index = 0; index < 100; index += 1) {
    updateSurveyMarkersV2(doc, current => ({
      ...current,
      marker: { ...current.marker, note: `edit-${index}` },
    }), { createId });
  }
  assert.equal(doc.store.clients.size, 1);
  assert.equal(materializeSurveyCrdtV2(doc).surveyMarkers.marker.note, 'edit-99');
});

test('the real row mapper optional undefined field keeps JSON absence semantics', () => {
  const mapped = mapSurveyMarkerRowToLocalAnnotation({
    id: 'row', annotation_id: 'marker', page_number: 1,
    bounds: { x: 1, y: 2, width: 3, height: 4 }, annotation_data: {},
    category_id: 'category', module_id: 'module', region_id: null,
    name: 'Mark', notes: null, entity_id: null, entity_name: null,
    checklist_responses: {}, changed_by: null, changed_date: null,
    color: '#ffff00', opacity: 0.3, version: 1, updated_at: null,
    user_id: 'actor', last_modified_by: 'actor',
  });
  assert.equal(Object.hasOwn(mapped, 'entityColor'), true);
  assert.equal(mapped.entityColor, undefined);
  const doc = new Y.Doc();
  initializeSurveyCrdtV2(doc, { surveyMarkers: { marker: mapped }, createId });
  const saved = materializeSurveyCrdtV2(doc).surveyMarkers.marker;
  assert.equal(Object.hasOwn(saved, 'entityColor'), false);
  updateSurveyMarkersV2(doc, current => ({
    ...current, marker: { ...current.marker, entityColor: undefined, note: 'updated' },
  }), { createId });
  assert.equal(materializeSurveyCrdtV2(doc).surveyMarkers.marker.note, 'updated');
  assert.throws(() => updateSurveyMarkersV2(doc, current => ({
    ...current, marker: { ...current.marker, unknownField: undefined },
  }), { createId }), { code: 'SURVEY_CRDT_V2_INVALID' });
});
