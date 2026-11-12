// Multi-sheet view rules (Nightly flag sheet-set-view), copied from
// Drawboard Projects: sheet order, stepping, keys, picker search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  projectSheets, steppedSheet, sheetPosition, sheetStepForKey, sheetLabel, sheetTitle,
  filterSheets, storedProjectOrder, GRID_AUTO, parseGridColumns, gridColumnsFor,
  sheetCardLabel, sheetRowParts, openAllChoice, narrowSheets,
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

test('grid columns: Auto is min(sheets, 4); any typed whole number; picker search', () => {
  assert.equal(parseGridColumns(null), GRID_AUTO);
  assert.equal(parseGridColumns('auto'), GRID_AUTO);
  assert.equal(parseGridColumns('6'), 6);
  assert.equal(parseGridColumns(0), 1);
  assert.equal(parseGridColumns('x'), GRID_AUTO);
  assert.equal(gridColumnsFor(GRID_AUTO, 2), 2);
  assert.equal(gridColumnsFor(GRID_AUTO, 5), 4);
  assert.equal(gridColumnsFor(GRID_AUTO, 16), 4);
  assert.equal(gridColumnsFor(12, 2), 12);
  const set = projectSheets(docs, 'p1');
  assert.deepEqual(filterSheets(set, 'm-1').map((d) => d.id), ['m1']);
  assert.equal(filterSheets(set, '  ').length, 3);
});

test('strip under a sheet names its revision; picker rows split number and name', () => {
  assert.equal(sheetCardLabel({ name: 'Mech.pdf', sheet_number: 'M-101', sheet_revision: 'C' }), 'M-101 - Mech - Rev C');
  assert.equal(sheetCardLabel({ name: 'A-2 Plan.pdf' }), 'A-2 Plan');
  assert.deepEqual(sheetRowParts({ name: 'Mech.pdf', sheet_number: 'M-101' }), { number: 'M-101', name: 'Mech' });
  assert.deepEqual(sheetRowParts({ name: 'A-101 - Level 1.pdf', sheet_number: 'A-101' }), { number: 'A-101', name: 'Level 1' });
  assert.deepEqual(sheetRowParts({ name: 'Loose.pdf' }), { number: 'Loose', name: '' });
});

test('Open all takes the list; two or more ticked rows make it Open N selected', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(openAllChoice(rows, null), { files: rows, label: 'Open all' });
  assert.deepEqual(openAllChoice(rows, new Set([2])), { files: rows, label: 'Open all' });
  assert.deepEqual(openAllChoice(rows, new Set([3, 1])), { files: [rows[0], rows[2]], label: 'Open 2 selected' });
  const set = projectSheets(docs, 'p1');
  assert.deepEqual(narrowSheets(set, ['a10', 'm1'], 'm1').map((d) => d.id), ['a10', 'm1']);
  // The open sheet left the chosen set, or one sheet is left: the whole project set stands.
  assert.equal(narrowSheets(set, ['a10', 'm1'], 'a2').length, 3);
  assert.equal(narrowSheets(set, ['a10'], 'a10').length, 3);
  assert.equal(narrowSheets(set, null, 'a10').length, 3);
});

test('flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['sheet-set-view']?.stage, 'beta');
});

test('Open all asks for List only for the sheet it opens (a failed open leaves no List behind)', () => {
  const tree = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(tree, /SHEET_VIEW_EVENT, \{\s*detail: \{ view: [^}]*forDocId: sheets\[0\]\.id, ids: sheets\.map/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /pendingSheetViewRef\.current = \{ view, docId: String\(forDocId\)/);
  assert.match(shell, /String\(sheetActiveDocId\) === pending\.docId/);
});
