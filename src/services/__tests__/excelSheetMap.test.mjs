import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import {
  SHEET_MAP_START_ROW,
  baseSheetNameFor,
  matchSheetToCategory,
  readSheetMap,
  writeSheetMap,
} from '../excelSheetMap.js';

const modules = [
  {
    id: 'm1', name: 'Floor 1',
    categories: [
      { id: 'c1', name: 'Doors' },
      { id: 'c2', name: 'Fire Alarm Pull Stations North' },
      { id: 'c3', name: 'Fire Alarm Pull Stations South' },
    ],
  },
];

async function roundTrip(build) {
  const book = new ExcelJS.Workbook();
  const meta = book.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
  meta.getCell('A1').value = 'template_id';
  meta.getCell('B5').value = 'wb_x';
  build(book, meta);
  const buffer = await book.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  return back;
}

test('the exporter name rule is unchanged (31 characters, no bad characters)', () => {
  assert.equal(baseSheetNameFor('Doors', 'Floor 1'), 'Doors - Floor 1');
  assert.equal(baseSheetNameFor('A/B: [x]', 'Lobby'), 'AB x - Lobby');
  assert.equal(baseSheetNameFor('Fire Alarm Pull Stations North', 'Floor 1').length, 31);
});

test('the sheet list survives a save and starts clear of the registration cells', async () => {
  const book = await roundTrip((_, meta) => writeSheetMap(meta, [
    { sheetName: 'Doors - Floor 1', moduleId: 'm1', categoryId: 'c1' },
    { sheetName: 'Fire Alarm Pull Stations North', moduleId: 'm1', categoryId: 'c2' },
    { sheetName: 'Fire Alarm Pull Stations (2)', moduleId: 'm1', categoryId: 'c3' },
  ]));
  assert.ok(SHEET_MAP_START_ROW > 6);
  const map = readSheetMap(book);
  assert.equal(map.size, 3);
  assert.deepEqual(map.get('Fire Alarm Pull Stations (2)'), { moduleId: 'm1', categoryId: 'c3' });
  assert.equal(book.getWorksheet('_SurveyMetadata').getCell('B5').value, 'wb_x');
});

test('a renamed category still finds its sheet through the list', () => {
  const renamed = [{ ...modules[0], categories: [{ id: 'c1', name: 'Entry Doors' }] }];
  const sheetMap = new Map([['Doors - Floor 1', { moduleId: 'm1', categoryId: 'c1' }]]);
  const match = matchSheetToCategory({ sheetName: 'Doors - Floor 1', modules: renamed, sheetMap });
  assert.equal(match?.category.id, 'c1');
  // Without the list (an older workbook) the rename loses the sheet, as before.
  assert.equal(matchSheetToCategory({ sheetName: 'Doors - Floor 1', modules: renamed }), null);
});

test('a suffixed sheet maps to the second category, not nothing', () => {
  const sheetMap = new Map([['Fire Alarm Pull Stations (2)', { moduleId: 'm1', categoryId: 'c3' }]]);
  assert.equal(matchSheetToCategory({ sheetName: 'Fire Alarm Pull Stations (2)', modules, sheetMap })?.category.id, 'c3');
  assert.equal(matchSheetToCategory({ sheetName: 'Fire Alarm Pull Stations (2)', modules }), null);
});

test('no list, or a list entry for a deleted category, falls back to the name rule', () => {
  assert.equal(matchSheetToCategory({ sheetName: 'Doors - Floor 1', modules })?.category.id, 'c1');
  const stale = new Map([['Doors - Floor 1', { moduleId: 'm1', categoryId: 'gone' }]]);
  assert.equal(matchSheetToCategory({ sheetName: 'Doors - Floor 1', modules, sheetMap: stale })?.category.id, 'c1');
  assert.equal(matchSheetToCategory({ sheetName: 'Unknown', modules, sheetMap: stale }), null);
});

test('reading never throws on a workbook without the metadata sheet', () => {
  assert.equal(readSheetMap(new ExcelJS.Workbook()).size, 0);
  assert.equal(readSheetMap(null).size, 0);
});
