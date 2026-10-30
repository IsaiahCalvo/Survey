import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { belongsToAnotherSurvey, readWorkbookSurvey, writeWorkbookSurvey } from '../excelWorkbookSurvey.js';
import { writeSheetMap, readSheetMap } from '../excelSheetMap.js';
import { PULL_BEFORE_PUSH, pullAllowsPush } from '../excelPushGate.js';

async function roundTrip(surveyId) {
  const book = new ExcelJS.Workbook();
  const meta = book.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
  meta.getCell('A1').value = 'template_id';
  meta.getCell('B5').value = 'wb_x';
  meta.getCell('B6').value = 'st_x';
  writeWorkbookSurvey(meta, surveyId);
  writeSheetMap(meta, [{ sheetName: 'Doors - Floor 1', moduleId: 'm1', categoryId: 'c1' }]);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await book.xlsx.writeBuffer());
  return back;
}

test('a workbook remembers the survey it was exported from (W9)', async () => {
  const back = await roundTrip('doc-a');
  assert.equal(readWorkbookSurvey(back), 'doc-a');
  // The stamp sits clear of the registration cells and the sheet list.
  const meta = back.getWorksheet('_SurveyMetadata');
  assert.equal(meta.getCell('B5').value, 'wb_x');
  assert.equal(meta.getCell('B6').value, 'st_x');
  assert.equal(readSheetMap(back).get('Doors - Floor 1').categoryId, 'c1');
});

test('only another survey on the same template is stopped; old and local files work as before', async () => {
  assert.equal(belongsToAnotherSurvey('doc-a', 'doc-b'), true);
  assert.equal(belongsToAnotherSurvey('doc-a', 'doc-a'), false);
  assert.equal(belongsToAnotherSurvey(null, 'doc-b'), false); // exported before the stamp
  assert.equal(belongsToAnotherSurvey('doc-a', null), false); // local-only survey
  assert.equal(readWorkbookSurvey(await roundTrip(null)), null);
  assert.equal(readWorkbookSurvey(null), null);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.FOREIGN), false);
});
