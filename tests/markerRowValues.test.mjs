import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveMarkerModuleData,
  buildMarkerRowValues,
} from '../src/services/markerRowValues.js';

test('resolveMarkerModuleData finds the matching item module block', () => {
  assert.deepEqual(resolveMarkerModuleData({ moduleDataKey: '' }), {});
  assert.deepEqual(resolveMarkerModuleData({
    items: {
      a: { name: 'Door', itemType: 'Doors', security: { entityName: 'Steel' } },
    },
    markerName: 'Door',
    categoryName: 'Doors',
    moduleDataKey: 'security',
  }), { entityName: 'Steel' });
  assert.deepEqual(resolveMarkerModuleData({
    items: { a: { name: 'Door', itemType: 'Windows' } },
    markerName: 'Door',
    categoryName: 'Doors',
    moduleDataKey: 'security',
  }), {});
});

test('buildMarkerRowValues mirrors export cell contents', () => {
  const values = buildMarkerRowValues({
    marker: {
      name: 'Door-1',
      entityName: 'Wood',
      changedBy: 'IC',
      changedDate: '2026-07-12T12:00:00.000Z',
      note: { text: 'ok' },
      checklistResponses: { c1: { selection: 'Y' } },
    },
    checklistItems: [{ id: 'c1' }, { id: 'c2' }, null],
    moduleData: { entityName: 'fallback' },
  });
  assert.equal(values.item, 'Door-1');
  assert.equal(values.entity, 'Wood');
  assert.equal(values.notes, 'ok');
  assert.equal(values.changedBy, 'IC');
  assert.equal(values.answers.c1, 'Y');
  assert.equal(values.answers.c2, '');
  assert.match(values.changedDate, /\d/);
});

test('buildMarkerRowValues falls back to module entity and empty date', () => {
  const values = buildMarkerRowValues({
    marker: { name: 'A' },
    moduleData: { entityName: 'FromModule' },
  });
  assert.equal(values.entity, 'FromModule');
  assert.equal(values.changedDate, '');
});
