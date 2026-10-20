import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFLICT_CLASS,
  detectFieldConflicts,
  hasRowConflict,
  classifyRowConflict,
} from '../src/services/excelConflictDetect.js';

const baseline = { item: 'a', entity: 'e', notes: 'n', answers: { c1: 'Y' } };

test('detectFieldConflicts reports app-only, excel-only, merge, and true conflicts', () => {
  assert.deepEqual(detectFieldConflicts({
    baseline,
    appNow: { ...baseline, notes: 'app' },
    excelIn: baseline,
  }).appChangedFields, ['notes']);

  assert.deepEqual(detectFieldConflicts({
    baseline,
    appNow: baseline,
    excelIn: { ...baseline, entity: 'x' },
  }).excelChangedFields, ['entity']);

  const merge = detectFieldConflicts({
    baseline,
    appNow: { ...baseline, notes: 'app' },
    excelIn: { ...baseline, entity: 'x' },
  });
  assert.deepEqual(merge.conflictFields, []);
  assert.equal(classifyRowConflict({
    baseline,
    appNow: { ...baseline, notes: 'app' },
    excelIn: { ...baseline, entity: 'x' },
  }), CONFLICT_CLASS.MERGE);

  const conflict = detectFieldConflicts({
    baseline,
    appNow: { ...baseline, notes: 'app' },
    excelIn: { ...baseline, notes: 'excel' },
  });
  assert.deepEqual(conflict.conflictFields, ['notes']);
  assert.equal(hasRowConflict({
    baseline,
    appNow: { ...baseline, notes: 'app' },
    excelIn: { ...baseline, notes: 'excel' },
  }), true);
  assert.equal(classifyRowConflict({
    baseline,
    appNow: { ...baseline, notes: 'app' },
    excelIn: { ...baseline, notes: 'excel' },
  }), CONFLICT_CLASS.CONFLICT);
});

test('classifyRowConflict covers none/app-only/excel-only', () => {
  assert.equal(classifyRowConflict({ baseline, appNow: baseline, excelIn: baseline }), CONFLICT_CLASS.NONE);
  assert.equal(classifyRowConflict({
    baseline,
    appNow: { ...baseline, item: 'B' },
    excelIn: baseline,
  }), CONFLICT_CLASS.APP_ONLY);
  assert.equal(classifyRowConflict({
    baseline,
    appNow: baseline,
    excelIn: { ...baseline, item: 'B' },
  }), CONFLICT_CLASS.EXCEL_ONLY);
});
