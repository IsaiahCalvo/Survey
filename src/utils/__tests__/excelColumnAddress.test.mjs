import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

import {
  buildSurveyWorksheetColumns,
  excelColumnLetter,
} from '../excelColumnAddress.js';

test('excelColumnLetter uses Excel A1 letters across the Z boundary', () => {
  assert.equal(excelColumnLetter(1), 'A');
  assert.equal(excelColumnLetter(26), 'Z');
  assert.equal(excelColumnLetter(27), 'AA');
  assert.equal(excelColumnLetter(52), 'AZ');
  assert.equal(excelColumnLetter(53), 'BA');
  assert.equal(excelColumnLetter(16_384), 'XFD');
});

test('excelColumnLetter rejects non-positive and non-integer column indices', () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, '5']) {
    assert.throws(() => excelColumnLetter(value), RangeError);
  }
  assert.throws(() => excelColumnLetter(16_385), RangeError);
});

test('buildSurveyWorksheetColumns keeps the current layout with no checklist items', () => {
  const columns = buildSurveyWorksheetColumns([]);

  assert.deepEqual(columns.headerRow, [
    'Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes',
  ]);
  assert.equal(columns.firstChecklistColumnLetter, null);
  assert.equal(columns.lastChecklistColumnLetter, null);
  assert.equal(columns.entityColumnLetter, 'E');
  assert.equal(columns.notesColumnLetter, 'F');
  assert.deepEqual(columns.columnMapping, {
    A: 'row_id',
    B: 'changed_by',
    C: 'changed_date',
    D: 'name',
    E: 'entity_name',
    F: 'notes',
  });
});

test('buildSurveyWorksheetColumns keeps input order and does not filter archived items', () => {
  const columns = buildSurveyWorksheetColumns([
    { id: 'live', text: 'Live check' },
    { id: 'archived', text: 'Old check', archived: true },
  ]);

  assert.deepEqual(columns.headerRow.slice(4, 6), ['Live check', 'Old check']);
  assert.equal(columns.columnMapping.E, 'checklist_live');
  assert.equal(columns.columnMapping.F, 'checklist_archived');
});

test('buildSurveyWorksheetColumns rejects a layout wider than Excel XFD', () => {
  const tooMany = Array.from({ length: 16_379 }, (_, index) => ({
    id: `item-${index}`,
    text: `Check ${index}`,
  }));
  assert.throws(() => buildSurveyWorksheetColumns(tooMany), RangeError);
});

for (const [count, expected] of [
  [20, { lastChecklist: 'X', entity: 'Y', notes: 'Z' }],
  [21, { lastChecklist: 'Y', entity: 'Z', notes: 'AA' }],
  [26, { lastChecklist: 'AD', entity: 'AE', notes: 'AF' }],
  [27, { lastChecklist: 'AE', entity: 'AF', notes: 'AG' }],
]) {
  test(`buildSurveyWorksheetColumns maps ${count} checklist items and trailing fields`, () => {
    const checklistItems = Array.from({ length: count }, (_, index) => ({
      id: `item-${index + 1}`,
      text: `Check ${index + 1}`,
    }));

    const columns = buildSurveyWorksheetColumns(checklistItems);

    assert.equal(columns.firstChecklistColumnLetter, 'E');
    assert.equal(columns.lastChecklistColumnLetter, expected.lastChecklist);
    assert.equal(columns.entityColumnLetter, expected.entity);
    assert.equal(columns.notesColumnLetter, expected.notes);
    assert.equal(columns.columnMapping[expected.lastChecklist], `checklist_item-${count}`);
    assert.equal(columns.columnMapping[expected.entity], 'entity_name');
    assert.equal(columns.columnMapping[expected.notes], 'notes');
    assert.equal(columns.headerRow.indexOf('Entity') + 1, columns.entityColumnIndex);
    assert.equal(columns.headerRow.indexOf('Notes') + 1, columns.notesColumnIndex);
    checklistItems.forEach((item, index) => {
      const importColumnIndex = columns.headerRow.indexOf(item.text);
      assert.equal(
        columns.columnMapping[excelColumnLetter(importColumnIndex + 1)],
        `checklist_${item.id}`,
      );
    });
  });
}

test('generated headers and letters survive an ExcelJS write-read round trip', async () => {
  const checklistItems = Array.from({ length: 27 }, (_, index) => ({
    id: `item-${index + 1}`,
    text: `Check ${index + 1}`,
  }));
  const columns = buildSurveyWorksheetColumns(checklistItems);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Survey');
  worksheet.addRow(columns.headerRow);
  worksheet.getCell(`${columns.lastChecklistColumnLetter}2`).dataValidation = {
    type: 'list',
    allowBlank: true,
    formulae: ['"Y,N,N/A"'],
  };

  const bytes = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(bytes);
  const loadedSheet = loaded.getWorksheet('Survey');

  assert.equal(loadedSheet.getCell(`${columns.lastChecklistColumnLetter}1`).value, 'Check 27');
  assert.equal(loadedSheet.getCell(`${columns.entityColumnLetter}1`).value, 'Entity');
  assert.equal(loadedSheet.getCell(`${columns.notesColumnLetter}1`).value, 'Notes');
  assert.deepEqual(
    loadedSheet.getCell(`${columns.lastChecklistColumnLetter}2`).dataValidation.formulae,
    ['"Y,N,N/A"'],
  );
});

test('PDFViewer static export uses the shared column layout and address helper', async () => {
  const source = await readFile(new URL('../../PDFViewer.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('const {\n              headerRow,\n              columnMapping,');
  const end = source.indexOf('// Set column widths', start);
  assert.notEqual(start, -1, 'static export must build its columns through the shared layout');
  assert.notEqual(end, -1, 'static export column section must be found');

  const staticExportColumns = source.slice(start, end);
  assert.match(staticExportColumns, /= buildSurveyWorksheetColumns\(checklistItems\)/);
  assert.match(staticExportColumns, /excelColumnLetter\(col\)/);
  assert.match(staticExportColumns, /`\$\{entityColumnLetter\}2:\$\{entityColumnLetter\}1000`/);
  assert.match(staticExportColumns, /`\$\{itemColumnLetter\}2:\$\{itemColumnLetter\}1000`/);
  assert.doesNotMatch(staticExportColumns, /String\.fromCharCode/);
});
