// Every spreadsheet Survey makes opens with filter buttons on its header row
// (owner 2026-11-15: "Make sure we can filter in exported excels"): the
// Export data workbook, the live linked workbook (Excel and Google Sheets)
// and the report. Real Excel on the web (11-15): a filter set on the header
// row alone takes in the rows the sync adds, and sync keeps writing every
// marker once with rows hidden by a filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { buildLiveWorkbook } from '../supabase/functions/_shared/sheetSync/providers/liveWorkbook.js';
import { buildSurveyReportXlsx } from '../src/services/surveyReportXlsx.js';
import { getReportKit } from '../src/services/reportKits/index.js';
import { setup, template, defaultKit, fakeFile, door } from './helpers/sheetSyncHarness.mjs';

const layout = buildSyncLayout({ template: template(), kit: defaultKit });

test('the live Excel workbook: filter buttons on each tab\'s header row, and Excel\'s name for them', async () => {
  const zip = await JSZip.loadAsync(buildLiveWorkbook(layout).bytes);
  for (const [i, scope] of layout.scopes.entries()) {
    const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`).async('string');
    const last = String.fromCharCode(64 + scope.columns.length);
    assert.match(xml, new RegExp(`<autoFilter ref="A1:${last}1"/>`), scope.title);
    // The parts Excel expects in their order: sheetData, autoFilter, conditional formats.
    assert.ok(xml.indexOf('</sheetData>') < xml.indexOf('<autoFilter') && xml.indexOf('<autoFilter') < xml.indexOf('<conditionalFormatting'));
  }
  const book = await zip.file('xl/workbook.xml').async('string');
  assert.equal((book.match(/name="_xlnm\._FilterDatabase"/g) || []).length, layout.scopes.length);
  // ExcelJS (what the app's own import reads with) opens it and sees the filter.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.ok(wb.worksheets[0].autoFilter, 'filter read back');
});

test('the live Google sheet: a filter over whole columns on each tab, so new rows filter too', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  for (const sheet of fakeFile(ctx).sheets) {
    const scope = layout.scopes.find((s) => s.title === sheet.title);
    assert.deepEqual(sheet.basicFilter, { sheetId: sheet.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: scope.columns.length }, sheet.title);
  }
  await ctx.round(); await ctx.round({ force: true });
  const doors = fakeFile(ctx).sheets.find((s) => s.title === layout.scopes[0].title);
  assert.ok(doors.rows.some((r) => (r || []).includes('D-101')), 'sync writes rows as before');
});

test('the report: Issues and Items have frozen, filterable header rows', async () => {
  const markers = { x1: { name: 'D-1', categoryId: 'doors', moduleId: 'm1', checklistResponses: { c1: { selection: 'N' } } } };
  const bytes = await buildSurveyReportXlsx({ ExcelJS, JSZip }, { template: template(), markers, documentName: 'A.pdf', kit: getReportKit('full-report') });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  for (const name of ['Issues', 'Items']) {
    const sheet = wb.getWorksheet(name);
    assert.ok(sheet.autoFilter, `${name} has filter buttons`);
    assert.equal(sheet.views[0]?.state, 'frozen', `${name} header frozen`);
  }
});

test('Export data puts filter buttons on every category tab, over its rows', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const at = src.indexOf("worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];");
  assert.ok(at > 0, 'frozen header still set');
  assert.match(src.slice(at, at + 400), /worksheet\.autoFilter = \{ from: \{ row: 1, column: 1 \}, to: \{ row: dataRows\.length, column: dataRows\[0\]\.length \} \};/);
});

test('addFilterNames: one hidden name per filtered tab, quotes escaped, never twice', async () => {
  const { addFilterNames } = await import('../src/services/xlsxFilterNames.js');
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Cam's & more");
  a.addRow(['Item', 'Note']); a.addRow(['D-1', 'x']);
  a.autoFilter = 'A1:B2';
  wb.addWorksheet('No filter').addRow(['x']);
  const once = await addFilterNames(JSZip, await wb.xlsx.writeBuffer());
  const twice = await addFilterNames(JSZip, once);
  for (const bytes of [once, twice]) {
    const book = await (await JSZip.loadAsync(bytes)).file('xl/workbook.xml').async('string');
    const names = book.match(/<definedName name="_xlnm\._FilterDatabase"[^>]*>[^<]*<\/definedName>/g) || [];
    assert.equal(names.length, 1, book);
    assert.match(names[0], /localSheetId="0" hidden="1">'Cam''s &amp; more'!\$A\$1:\$B\$2</);
  }
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(once);
  assert.ok(back.getWorksheet("Cam's & more").autoFilter, 'ExcelJS still reads it');
});
