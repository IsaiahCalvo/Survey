// Nightly 'survey-report': the report as an Excel workbook with a real chart
// that reads the Summary cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildSurveyReportXlsx, surveyReportXlsxFileName } from '../src/services/surveyReportXlsx.js';
import { getReportKit } from '../src/services/reportKits/index.js';

const template = {
  name: 'Fire & Life Safety',
  modules: [{ id: 'm', name: 'M', categories: ['Doors', 'Cameras', 'Card readers'].map((n, i) => ({ id: `c${i}`, name: n, checklist: [{ id: 'a', text: 'Mounted' }, { id: 'b', text: 'Tag current' }] })) }],
};
const markers = {};
for (let i = 0; i < 12; i++) {
  markers[`x${i}`] = {
    name: `Item ${i}`,
    categoryId: `c${i % 3}`,
    checklistResponses: i % 3 === 0 ? { a: { selection: 'Y' }, b: { selection: 'N' } } : i % 4 === 1 ? { a: { selection: 'Y' } } : {},
  };
}

const build = async (kitId) => {
  const bytes = await buildSurveyReportXlsx({ ExcelJS, JSZip }, { template, markers, documentName: 'Plan A.pdf', kit: getReportKit(kitId) });
  if (process.env.SURVEY_REPORT_XLSX_OUT) writeFileSync(`${process.env.SURVEY_REPORT_XLSX_OUT}/${kitId}.xlsx`, bytes);
  return JSZip.loadAsync(bytes);
};

test('the full report: Summary with a stacked bar chart of the category cells, Issues and Items', async () => {
  const zip = await build('full-report');
  const chart = await zip.file('xl/charts/chart1.xml').async('string');
  assert.match(chart, /<c:barChart><c:barDir val="bar"\/><c:grouping val="stacked"\/>/);
  assert.match(chart, /<c:f>'Summary'!\$B\$9:\$B\$11<\/c:f>/);
  assert.match(chart, /<c:f>'Summary'!\$A\$9:\$A\$11<\/c:f>/);
  assert.match(await zip.file('xl/worksheets/sheet1.xml').async('string'), /<drawing r:id="rIdSurveyChart"\/>/);
  assert.match(await zip.file('[Content_Types].xml').async('string'), /drawingml\.chart\+xml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Issues', 'Items']);
  const summary = wb.getWorksheet('Summary');
  assert.deepEqual(summary.getRow(8).values.slice(1), ['Category', 'Done', 'Partly done', 'Not started', 'Items', 'With issues']);
  assert.equal(summary.getCell('A9').value, 'Doors');
  assert.equal(wb.getWorksheet('Items').rowCount, 13);
});

test('the progress layout draws a pie; the issues layout has no chart', async () => {
  const pie = await build('progress-report');
  assert.match(await pie.file('xl/charts/chart1.xml').async('string'), /<c:pieChart>/);
  assert.equal(pie.file('xl/worksheets/sheet2.xml') !== null, true, 'Items sheet');
  const issues = await build('issues-report');
  assert.equal(issues.file('xl/charts/chart1.xml'), null);
  assert.equal(surveyReportXlsxFileName({ name: 'A/B' }), 'A B report.xlsx');
});
