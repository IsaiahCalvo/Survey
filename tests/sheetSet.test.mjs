// Multi-sheet view rules (Nightly flag sheet-set-view), copied from
// Drawboard Projects: sheet order, stepping, keys, picker search.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectSheets, steppedSheet, sheetPosition, sheetStepForKey, sheetLabel, sheetTitle,
  clampGridColumns, filterSheets, GRID_COLUMNS, storedProjectOrder,
} from '../src/sheets/sheetSet.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const docs = [
  { id: 'a10', name: 'A-10 Roof.pdf', project_id: 'p1' },
  { id: 'a2', name: 'A-2 Plan.pdf', project_id: 'p1' },
  { id: 'm1', name: 'Mech.pdf', project_id: 'p1', sheet_number: 'M-101' },
  { id: 'old', name: 'A-1 Old.pdf', project_id: 'p1', superseded_by: 'a2' },
  { id: 'gone', name: 'A-3.pdf', project_id: 'p1', archived: true },
  { id: 'x', name: 'Other.pdf', project_id: 'p2' },
  { id: 'loose', name: 'Loose.pdf', project_id: null },
];

test('a project\'s current sheets in sheet order (numbers read as numbers)', () => {
  assert.deepEqual(projectSheets(docs, 'p1').map((d) => d.id), ['a2', 'a10', 'm1']);
  assert.deepEqual(projectSheets(docs, null), []);
  assert.deepEqual(projectSheets(docs, 'p2').map((d) => d.id), ['x']);
});

test('the person\'s own Files order wins; the rest follow in sheet order', () => {
  assert.deepEqual(projectSheets(docs, 'p1', ['m1', 'a10']).map((d) => d.id), ['m1', 'a10', 'a2']);
  assert.deepEqual(storedProjectOrder({ documentOrderByProject: { p1: ['m1'] } }, 'p1'), ['m1']);
  assert.equal(storedProjectOrder({}, 'p1'), null);
});

test('arrows step one sheet and stop at the ends', () => {
  const set = projectSheets(docs, 'p1');
  assert.equal(steppedSheet(set, 'a2', 1).id, 'a10');
  assert.equal(steppedSheet(set, 'a10', -1).id, 'a2');
  assert.equal(steppedSheet(set, 'a2', -1), null);
  assert.equal(steppedSheet(set, 'm1', 1), null);
  assert.equal(steppedSheet(set, 'nope', 1), null);
  assert.deepEqual(sheetPosition(set, 'a10'), { index: 1, count: 3 });
});

test('Shift+Left / Right step; other keys do not', () => {
  assert.equal(sheetStepForKey({ key: 'ArrowRight', shiftKey: true }), 1);
  assert.equal(sheetStepForKey({ key: 'ArrowLeft', shiftKey: true }), -1);
  assert.equal(sheetStepForKey({ key: 'ArrowLeft' }), 0);
  assert.equal(sheetStepForKey({ key: 'ArrowLeft', shiftKey: true, ctrlKey: true }), 0);
  assert.equal(sheetStepForKey({ key: 'ArrowLeft', shiftKey: true, altKey: true }), 0);
  // Ctrl+[ / ] arrange marks in Survey; they never change sheet.
  assert.equal(sheetStepForKey({ key: ']', code: 'BracketRight', ctrlKey: true }), 0);
});

test('labels: number then name, never the number twice', () => {
  assert.equal(sheetLabel({ name: 'Mech.pdf', sheet_number: 'M-101' }), 'M-101 - Mech');
  assert.equal(sheetLabel({ name: 'A-101 Plan.pdf', sheet_number: 'A-101' }), 'A-101 Plan');
  assert.equal(sheetTitle({ name: '' }), 'Untitled');
});

test('grid shows 4 to 8 sheets a row; picker search', () => {
  assert.deepEqual(GRID_COLUMNS, [4, 5, 6, 7, 8]);
  assert.equal(clampGridColumns(2), 4);
  assert.equal(clampGridColumns(12), 8);
  assert.equal(clampGridColumns('6'), 6);
  assert.equal(clampGridColumns('x'), 4);
  const set = projectSheets(docs, 'p1');
  assert.deepEqual(filterSheets(set, 'm-1').map((d) => d.id), ['m1']);
  assert.equal(filterSheets(set, '  ').length, 3);
});

test('flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['sheet-set-view']?.stage, 'beta');
});
