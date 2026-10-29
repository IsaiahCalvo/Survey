import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyExcelValuesToMarker } from '../excelConflictResolve.js';
import { buildMarkerRowValues } from '../markerRowValues.js';
import { computeRowFingerprints, diffRowFields } from '../rowFingerprint.js';

const checklist = [{ id: 'chk-1', text: 'Locked?' }, { id: 'chk-2', text: 'Lit?' }];
const entities = [{ id: 'e-north', name: 'North', color: '#ff0000' }];

const baseMarker = {
  name: 'Door 12',
  entityName: 'South',
  entityId: 'e-south',
  entityColor: '#0000ff',
  note: { text: 'app note', author: 'IC' },
  checklistResponses: { 'chk-1': { selection: 'Y', by: 'IC' }, 'chk-2': { selection: 'N' } },
  changedBy: 'IC',
  changedDate: '2026-06-01T00:00:00.000Z',
  page: 3,
  x: 100,
  y: 200
};

const excelValues = {
  item: 'Door 12 Renamed',
  entity: 'North',
  notes: 'excel note',
  changedBy: 'AB',
  changedDate: '6/8/2026',
  answers: { 'chk-1': 'N', 'chk-2': 'N/A' }
};

test('use Excel: applies item, entity name, notes, answers, changedBy', () => {
  const next = applyExcelValuesToMarker(baseMarker, excelValues, entities);
  assert.equal(next.name, 'Door 12 Renamed');
  assert.equal(next.entityName, 'North');
  assert.equal(next.note.text, 'excel note');
  assert.equal(next.checklistResponses['chk-1'].selection, 'N');
  assert.equal(next.checklistResponses['chk-2'].selection, 'N/A');
  assert.equal(next.changedBy, 'AB');
});

test('use Excel: resolves entity id + color when the name matches a template entity', () => {
  const next = applyExcelValuesToMarker(baseMarker, excelValues, entities);
  assert.equal(next.entityId, 'e-north');
  assert.equal(next.entityColor, '#ff0000');
});

test('use Excel: keeps existing entity id/color when no template entity matches the name', () => {
  const next = applyExcelValuesToMarker(baseMarker, { ...excelValues, entity: 'Unknown Co' }, entities);
  assert.equal(next.entityName, 'Unknown Co');
  assert.equal(next.entityId, 'e-south');
  assert.equal(next.entityColor, '#0000ff');
});

test('use Excel: never mutates the input and preserves PDF placement + unrelated fields', () => {
  const snapshot = JSON.parse(JSON.stringify(baseMarker));
  const next = applyExcelValuesToMarker(baseMarker, excelValues, entities);
  assert.deepEqual(baseMarker, snapshot, 'input marker untouched');
  assert.equal(next.page, 3);
  assert.equal(next.x, 100);
  assert.equal(next.y, 200);
  assert.equal(next.checklistResponses['chk-1'].by, 'IC', 'sibling response fields preserved');
  assert.equal(next.note.author, 'IC', 'sibling note fields preserved');
});

test('after "use Excel", the marker rebuilds to the SAME substantive values as Excel', async () => {
  const next = applyExcelValuesToMarker(baseMarker, excelValues, entities);
  const rebuilt = buildMarkerRowValues({ marker: next, checklistItems: checklist });
  // Substantive content (the conflict surface) must now agree with Excel.
  assert.equal(rebuilt.item, excelValues.item);
  assert.equal(rebuilt.entity, excelValues.entity);
  assert.equal(rebuilt.notes, excelValues.notes);
  assert.deepEqual(rebuilt.answers, excelValues.answers);

  // And no substantive field still diffs against Excel → no residual conflict next sync.
  const a = (await computeRowFingerprints(rebuilt)).fieldFingerprints;
  const b = (await computeRowFingerprints(excelValues)).fieldFingerprints;
  const changed = diffRowFields(a, b).filter((f) => f !== 'changedBy' && f !== 'changedDate');
  assert.deepEqual(changed, [], 'item/entity/notes/answers all agree with Excel');
});

// --- The choice decides only the disputed fields -------------------------------------

import { applyExcelFieldsToMarker, excelFieldsForConflictChoice } from '../excelConflictResolve.js';

test('"use Excel" writes every field Excel changed and leaves app-only edits alone', () => {
  const fields = excelFieldsForConflictChoice({
    choice: 'excel', excelChangedFields: ['answer:chk-1', 'notes'], conflictFields: ['answer:chk-1']
  });
  assert.deepEqual(fields.sort(), ['answer:chk-1', 'notes']);
  // The app had renamed the marker (an app-only edit). Excel's row still carries the old
  // name, but "item" is not an Excel change, so the rename survives.
  const appMarker = { ...baseMarker, name: 'Door 12A' };
  const out = applyExcelFieldsToMarker(appMarker, {
    item: 'Door 12', entity: 'South', notes: 'excel note', changedBy: 'XL', answers: { 'chk-1': 'N', 'chk-2': 'N' }
  }, entities, fields);
  assert.equal(out.name, 'Door 12A');
  assert.equal(out.note.text, 'excel note');
  assert.equal(out.note.author, 'IC');
  assert.equal(out.checklistResponses['chk-1'].selection, 'N');
  assert.equal(out.checklistResponses['chk-1'].by, 'IC');
  assert.equal(out.changedBy, 'IC'); // changedBy was not an Excel change
});

test('"keep mine" still takes Excel\'s undisputed edits', () => {
  const fields = excelFieldsForConflictChoice({
    choice: 'app', excelChangedFields: ['answer:chk-1', 'notes'], conflictFields: ['answer:chk-1']
  });
  assert.deepEqual(fields, ['notes']);
  const out = applyExcelFieldsToMarker(baseMarker, { notes: 'excel note', answers: { 'chk-1': 'N' } }, entities, fields);
  assert.equal(out.note.text, 'excel note');
  assert.equal(out.checklistResponses['chk-1'].selection, 'Y'); // the app's disputed answer stays
});

test('field apply resolves the entity and never touches the Changed Date', () => {
  const out = applyExcelFieldsToMarker(baseMarker, { entity: 'North', changedDate: '2030-01-01' }, entities, ['entity', 'changedDate']);
  assert.equal(out.entityId, 'e-north');
  assert.equal(out.entityColor, '#ff0000');
  assert.equal(out.changedDate, baseMarker.changedDate);
});

test('an answer column missing from the row is left alone', () => {
  const out = applyExcelFieldsToMarker(baseMarker, { answers: {} }, entities, ['answer:chk-2']);
  assert.equal(out.checklistResponses['chk-2'].selection, 'N');
});

test('no fields → the same marker back', () => {
  assert.equal(applyExcelFieldsToMarker(baseMarker, {}, entities, []), baseMarker);
});
