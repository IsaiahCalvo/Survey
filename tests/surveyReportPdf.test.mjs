// Nightly 'survey-report': the report as a PDF, block by block from the
// template's report kit, with tables that page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as PDFLib from 'pdf-lib';
import { buildSurveyReportPdf, surveyReportPdfFileName } from '../src/services/surveyReportPdf.js';
import { getReportKit } from '../src/services/reportKits/index.js';

const cats = ['Doors', 'Fire extinguishers — level 2 east wing', 'Cameras', 'Card readers'];
const template = {
  name: 'Fire & Life Safety',
  modules: [{ id: 'm', name: 'M', categories: cats.map((n, i) => ({ id: `c${i}`, name: n, checklist: [{ id: 'a', text: 'Mounted' }, { id: 'b', text: 'Tag current' }] })) }],
};
const markers = {};
for (let i = 0; i < 60; i++) {
  markers[`x${i}`] = {
    // A name the standard PDF fonts cannot draw still makes a report.
    name: `Item ${i} 中`,
    categoryId: `c${i % 4}`,
    checklistResponses: i % 3 === 0 ? { a: { selection: 'Y' }, b: { selection: 'N' } } : i % 3 === 1 ? { a: { selection: 'Y' } } : {},
  };
}

const pages = async (kitId, input = { template, markers }) => {
  const bytes = await buildSurveyReportPdf(PDFLib, { ...input, documentName: 'Plan A.pdf', kit: getReportKit(kitId) });
  if (process.env.SURVEY_REPORT_PDF_OUT) writeFileSync(`${process.env.SURVEY_REPORT_PDF_OUT}/${kitId}.pdf`, bytes);
  return (await PDFLib.PDFDocument.load(bytes)).getPageCount();
};

test('each report layout draws its blocks; long issue lists page', async () => {
  // Cover, Progress (tiles + bars), By category, Issues (20 items, 2 pages).
  assert.equal(await pages('full-report'), 5);
  assert.equal(await pages('progress-report'), 3);
  assert.equal(await pages('issues-report'), 3);
});

test('an empty survey still makes a report', async () => {
  assert.equal(await pages('full-report', { template, markers: {} }), 3);
  assert.equal(surveyReportPdfFileName({ name: 'A/B: C' }), 'A B C report.pdf');
});
