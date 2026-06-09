import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMarkerRowValues, resolveMarkerModuleData } from '../markerRowValues.js';
import { computeRowFingerprints } from '../rowFingerprint.js';

const checklist = [
  { id: 'chk-1', text: 'Locked?' },
  { id: 'chk-2', text: 'Lit?' }
];

test('extracts the visible row values in the export shape', () => {
  const marker = {
    changedBy: 'IC',
    changedDate: '2026-06-08T12:00:00.000Z',
    name: 'Door 12',
    entityName: 'North Wing',
    note: { text: 'check hinge' },
    checklistResponses: { 'chk-1': { selection: 'Y' }, 'chk-2': { selection: 'N/A' } }
  };
  const values = buildMarkerRowValues({ marker, checklistItems: checklist });
  assert.equal(values.changedBy, 'IC');
  assert.equal(values.changedDate, new Date('2026-06-08T12:00:00.000Z').toLocaleDateString('en-US'));
  assert.equal(values.item, 'Door 12');
  assert.equal(values.entity, 'North Wing');
  assert.equal(values.notes, 'check hinge');
  assert.deepEqual(values.answers, { 'chk-1': 'Y', 'chk-2': 'N/A' });
});

test('blank changedDate stays blank (no wall-clock read, no "now" injected)', () => {
  const values = buildMarkerRowValues({ marker: { name: 'X' }, checklistItems: checklist });
  assert.equal(values.changedDate, '');
  assert.equal(values.changedBy, '');
  assert.deepEqual(values.answers, { 'chk-1': '', 'chk-2': '' });
});

test('missing checklist response becomes empty string, never undefined', () => {
  const marker = { name: 'X', checklistResponses: { 'chk-1': { selection: 'Y' } } };
  const values = buildMarkerRowValues({ marker, checklistItems: checklist });
  assert.equal(values.answers['chk-2'], '');
});

test('entity falls back to module data only when the marker has no entityName', () => {
  const moduleData = { entityName: 'Fallback Co' };
  const withName = buildMarkerRowValues({ marker: { name: 'X', entityName: 'Real Co' }, checklistItems: [], moduleData });
  assert.equal(withName.entity, 'Real Co', 'marker entityName wins');
  const withoutName = buildMarkerRowValues({ marker: { name: 'X' }, checklistItems: [], moduleData });
  assert.equal(withoutName.entity, 'Fallback Co', 'falls back to module data');
});

test('resolveMarkerModuleData mirrors the export item lookup (name + itemType)', () => {
  const items = {
    a: { name: 'Door 12', itemType: 'Doors', doorsData: { entityName: 'North' } },
    b: { name: 'Door 12', itemType: 'Windows', windowsData: { entityName: 'Wrong' } }
  };
  const md = resolveMarkerModuleData({ items, markerName: 'Door 12', categoryName: 'Doors', moduleDataKey: 'doorsData' });
  assert.equal(md.entityName, 'North');
  // No matching item → {}
  assert.deepEqual(resolveMarkerModuleData({ items, markerName: 'Nope', categoryName: 'Doors', moduleDataKey: 'doorsData' }), {});
});

test('CRITICAL: same marker built twice → identical fingerprints (no false conflict)', async () => {
  const marker = {
    changedBy: 'IC', changedDate: '2026-06-08T12:00:00.000Z', name: 'Door 12',
    entityName: 'North', note: { text: 'ok' },
    checklistResponses: { 'chk-1': { selection: 'Y' }, 'chk-2': { selection: 'N' } }
  };
  const a = await computeRowFingerprints(buildMarkerRowValues({ marker, checklistItems: checklist }));
  const b = await computeRowFingerprints(buildMarkerRowValues({ marker, checklistItems: checklist }));
  assert.equal(a.fullRowFingerprint, b.fullRowFingerprint);
  assert.deepEqual(a.fieldFingerprints, b.fieldFingerprints);
});

test('CRITICAL round-trip: export cells → import read-back → identical fingerprints', async () => {
  // The export header order, mirrored by the importer's column resolution.
  const headerRow = ['Row ID', 'Changed By', 'Changed Date', 'Item', 'Locked?', 'Lit?', 'Entity', 'Notes'];
  const marker = {
    changedBy: 'IC', changedDate: '2026-06-08T12:00:00.000Z', name: 'Door 12',
    entityName: 'North', note: { text: 'ok' },
    checklistResponses: { 'chk-1': { selection: 'Y' }, 'chk-2': { selection: 'N' } }
  };
  const exportValues = buildMarkerRowValues({ marker, checklistItems: checklist });

  // Export pushes the cells from the values, in header order.
  const cells = [
    'TOKEN',
    exportValues.changedBy,
    exportValues.changedDate,
    exportValues.item,
    exportValues.answers['chk-1'],
    exportValues.answers['chk-2'],
    exportValues.entity,
    exportValues.notes
  ];

  // Import reads them back by header index (mirrors buildScopeImportPlans.buildValues).
  const idx = (h) => headerRow.indexOf(h);
  const importValues = {
    changedBy: cells[idx('Changed By')],
    changedDate: cells[idx('Changed Date')],
    item: cells[idx('Item')],
    entity: cells[idx('Entity')],
    notes: cells[idx('Notes')],
    answers: { 'chk-1': cells[idx('Locked?')], 'chk-2': cells[idx('Lit?')] }
  };

  const exp = await computeRowFingerprints(exportValues);
  const imp = await computeRowFingerprints(importValues);
  assert.equal(exp.fullRowFingerprint, imp.fullRowFingerprint, 'round-trip must not change the fingerprint');
  assert.deepEqual(exp.fieldFingerprints, imp.fieldFingerprints);
});
