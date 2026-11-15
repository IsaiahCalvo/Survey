// Survey's spreadsheets read well for a PM in Excel and Google Sheets (11-15):
// the export's column widths, notes that wrap, answers and entities in their
// colours, and printing one page wide with the header on every page and the
// tab name and page number below. All of it is formatting the sync never
// reads, so sync is checked as before around it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { buildLiveWorkbook, widthOf } from '../supabase/functions/_shared/sheetSync/providers/liveWorkbook.js';
import { excelPoints } from '../supabase/functions/_shared/sheetSync/providers/msgraph.js';
import { setup, template, defaultKit, fakeFile, door } from './helpers/sheetSyncHarness.mjs';

const layout = buildSyncLayout({ template: template(), kit: defaultKit });

test('the live Excel workbook: notes wrap, and each printed page carries the tab name and page number', async () => {
  const bytes = buildLiveWorkbook(layout).bytes;
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(xml, /<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"\/><headerFooter><oddFooter>&amp;L&amp;A&amp;RPage &amp;P of &amp;N<\/oddFooter><\/headerFooter><\/worksheet>$/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  const sheet = wb.worksheets[0];
  const notesAt = layout.scopes[0].columns.findIndex((c) => c.key === 'notes') + 1;
  assert.ok(notesAt > 0);
  assert.equal(sheet.getColumn(notesAt).alignment?.wrapText, true, 'notes wrap');
  assert.equal(sheet.getColumn(notesAt).numFmt, '@', 'notes stay text');
  assert.equal(sheet.getColumn(notesAt).width, 50);
  assert.equal(sheet.headerFooter.oddFooter, '&L&A&RPage &P of &N');
  assert.equal(sheet.pageSetup.fitToWidth, 1);
  // Other text columns do not wrap.
  const itemAt = layout.scopes[0].columns.findIndex((c) => c.key === 'item') + 1;
  assert.ok(!sheet.getColumn(itemAt).alignment?.wrapText);
});

test('Graph widths match the workbook\'s', () => {
  assert.equal(excelPoints(15), 82.5);
  assert.equal(excelPoints(50), 266.25);
  assert.equal(widthOf({ key: 'notes' }), 50);
});

test('the live Google sheet: the export\'s widths, wrapped notes, answer and entity colours, and sync as before', async () => {
  const ctx = await setup({ markers: { d1: door('d1', 'D-101') } });
  for (const sheet of fakeFile(ctx).sheets) {
    const scope = layout.scopes.find((s) => s.title === sheet.title);
    scope.columns.forEach((col, i) => assert.equal(sheet.widths?.[i], Math.trunc(widthOf(col) * 7 + 5), `${sheet.title} ${col.header}`));
    const notesAt = scope.columns.findIndex((c) => c.key === 'notes');
    assert.deepEqual(sheet.wrapColumns, [notesAt], 'only notes wrap');
    const entityAt = scope.columns.findIndex((c) => c.key === 'entity');
    const choiceAt = scope.columns.findIndex((c) => c.key.startsWith('answer:') && (!c.item?.kind || c.item.kind === 'choice'));
    const rules = sheet.colorRules || [];
    assert.deepEqual(rules.filter((r) => r.column === entityAt).map((r) => r.value).sort(), ['Installed', 'Missing']);
    if (choiceAt >= 0) assert.ok(rules.some((r) => r.column === choiceAt && r.value === 'Y'), 'answers coloured');
  }
  await ctx.round(); await ctx.round({ force: true });
  const doors = fakeFile(ctx).sheets.find((s) => s.title === layout.scopes[0].title);
  assert.ok(doors.rows.some((r) => (r || []).includes('D-101')), 'sync writes rows as before');
});

test('Export data: notes wrap and each printed page has the tab name and page number', () => {
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const at = src.indexOf('worksheet.getColumn(notesColIndex).width = 50;');
  assert.ok(at > 0);
  assert.match(src.slice(at, at + 300), /eachCell\(\(cell, rowNum\) => \{ if \(rowNum > 1\) cell\.alignment = \{ \.\.\.cell\.alignment, wrapText: true, vertical: 'middle' \}; \}\)/);
  assert.match(src, /worksheet\.headerFooter = \{ \.\.\.worksheet\.headerFooter, oddFooter: '&L&A&RPage &P of &N' \};/);
});
