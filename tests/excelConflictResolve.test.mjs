import test from 'node:test';
import assert from 'node:assert/strict';

import { applyExcelValuesToMarker } from '../src/services/excelConflictResolve.js';

test('applyExcelValuesToMarker copies Excel content onto a new marker', () => {
  const marker = {
    id: 'm1',
    name: 'Old',
    entityId: 'old-id',
    entityColor: '#111',
    entityName: 'OldEntity',
    note: { text: 'old note' },
    checklistResponses: { c1: { selection: 'N', note: 'keep' } },
    changedBy: 'AA',
  };
  const next = applyExcelValuesToMarker(marker, {
    item: 'New',
    entity: 'Pump',
    notes: 'excel note',
    changedBy: 'BB',
    answers: { c1: 'Y', c2: 'N/A' },
  }, [{ id: 'pump-id', name: 'Pump', color: '#f00' }]);

  assert.notEqual(next, marker);
  assert.equal(next.name, 'New');
  assert.equal(next.entityName, 'Pump');
  assert.equal(next.entityId, 'pump-id');
  assert.equal(next.entityColor, '#f00');
  assert.equal(next.note.text, 'excel note');
  assert.equal(next.changedBy, 'BB');
  assert.equal(next.checklistResponses.c1.selection, 'Y');
  assert.equal(next.checklistResponses.c1.note, 'keep');
  assert.equal(next.checklistResponses.c2.selection, 'N/A');
});

test('applyExcelValuesToMarker keeps entity ids when Excel entity is unknown', () => {
  const marker = { entityId: 'keep', entityColor: '#abc', name: 'A' };
  const next = applyExcelValuesToMarker(marker, { item: '', entity: 'Missing', notes: '' }, []);
  assert.equal(next.name, 'A');
  assert.equal(next.entityId, 'keep');
  assert.equal(next.entityColor, '#abc');
  assert.equal(next.entityName, 'Missing');
});
