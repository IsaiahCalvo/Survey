import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { openOnFirstVisibleSheet } from '../src/services/excelOpeningSheet.js';

test('a Survey export opens on the first sheet a person can see, not the hidden metadata sheet', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
  workbook.addWorksheet('Door - Access Control');
  workbook.addWorksheet('Camera - CCTV');
  assert.equal(openOnFirstVisibleSheet(workbook), 1);

  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const book = await zip.file('xl/workbook.xml').async('string');
  assert.match(book, /activeTab="1"/);
  const meta = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const first = await zip.file('xl/worksheets/sheet2.xml').async('string');
  assert.doesNotMatch(meta, /tabSelected="1"/);
  assert.match(first, /tabSelected="1"/);
});

test('a workbook with no visible sheet is left alone', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
  assert.equal(openOnFirstVisibleSheet(workbook), -1);
});
