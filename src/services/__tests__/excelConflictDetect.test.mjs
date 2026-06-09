import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectFieldConflicts, hasRowConflict, classifyRowConflict, CONFLICT_CLASS } from '../excelConflictDetect.js';

// Per-field fingerprint sets in the shape rowFingerprint produces. We use plain strings as
// stand-in fingerprints — the detector only compares for equality, never interprets them.
const fp = (item, entity, notes, answers = {}) => ({
  changedBy: 'cb', changedDate: 'cd', item, entity, notes, answers
});

test('nothing changed → NONE, no conflict', () => {
  const base = fp('A', 'E1', 'note');
  const r = detectFieldConflicts({ baseline: base, appNow: { ...base }, excelIn: { ...base } });
  assert.deepEqual(r.conflictFields, []);
  assert.equal(hasRowConflict({ baseline: base, appNow: { ...base }, excelIn: { ...base } }), false);
  assert.equal(classifyRowConflict({ baseline: base, appNow: { ...base }, excelIn: { ...base } }), CONFLICT_CLASS.NONE);
});

test('only Excel changed a field → EXCEL_ONLY, no conflict', () => {
  const base = fp('A', 'E1', 'note');
  const args = { baseline: base, appNow: { ...base }, excelIn: fp('A', 'E1', 'note edited') };
  assert.equal(hasRowConflict(args), false);
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.EXCEL_ONLY);
  assert.deepEqual(detectFieldConflicts(args).excelChangedFields, ['notes']);
});

test('only the app changed a field → APP_ONLY, no conflict', () => {
  const base = fp('A', 'E1', 'note');
  const args = { baseline: base, appNow: fp('A', 'E2', 'note'), excelIn: { ...base } };
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.APP_ONLY);
  assert.deepEqual(detectFieldConflicts(args).appChangedFields, ['entity']);
});

test('both sides changed DIFFERENT fields → MERGE, not a conflict', () => {
  const base = fp('A', 'E1', 'note');
  const args = { baseline: base, appNow: fp('A', 'E2', 'note'), excelIn: fp('A', 'E1', 'note edited') };
  assert.equal(hasRowConflict(args), false);
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.MERGE);
});

test('same field changed on both sides, disagreeing → CONFLICT', () => {
  const base = fp('A', 'E1', 'note');
  const args = { baseline: base, appNow: fp('A', 'E1', 'app note'), excelIn: fp('A', 'E1', 'excel note') };
  assert.equal(hasRowConflict(args), true);
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.CONFLICT);
  assert.deepEqual(detectFieldConflicts(args).conflictFields, ['notes']);
});

test('same field changed on both sides to the SAME value → not a conflict', () => {
  const base = fp('A', 'E1', 'note');
  const args = { baseline: base, appNow: fp('A', 'E1', 'same new'), excelIn: fp('A', 'E1', 'same new') };
  assert.equal(hasRowConflict(args), false);
  // Both moved off baseline identically → no disagreement → treated as already-in-agreement.
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.MERGE);
});

test('answer-level conflict is detected per checklist item', () => {
  const base = fp('A', 'E1', 'note', { q1: 'Y', q2: 'N' });
  const args = {
    baseline: base,
    appNow: fp('A', 'E1', 'note', { q1: 'N', q2: 'N' }),   // app changed q1
    excelIn: fp('A', 'E1', 'note', { q1: 'N/A', q2: 'N' })  // excel changed q1 differently
  };
  assert.deepEqual(detectFieldConflicts(args).conflictFields, ['answer:q1']);
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.CONFLICT);
});

test('different answers changed on each side → MERGE', () => {
  const base = fp('A', 'E1', 'note', { q1: 'Y', q2: 'N' });
  const args = {
    baseline: base,
    appNow: fp('A', 'E1', 'note', { q1: 'N', q2: 'N' }),   // app changed q1
    excelIn: fp('A', 'E1', 'note', { q1: 'Y', q2: 'Y' })   // excel changed q2
  };
  assert.deepEqual(detectFieldConflicts(args).conflictFields, []);
  assert.equal(classifyRowConflict(args), CONFLICT_CLASS.MERGE);
});
