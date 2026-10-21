import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { addSummarySheet } from '../src/services/excelSummarySheet.js';
import { summarizeSurvey } from '../src/services/surveySummary.js';

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Pass', tone: 'good' }, { value: 'Fail', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
  modules: [{
    id: 'mod-1',
    name: 'Level 1',
    categories: [
      { id: 'cat-door', name: 'Door', checklist: [{ id: 'c1', text: 'Lock' }, { id: 'c2', text: 'Reader' }, { id: 'c3', text: 'Old', archived: true }] },
      { id: 'cat-cam', name: 'Camera', checklist: [{ id: 'k1', text: 'Mounted' }] },
      { id: 'cat-empty', name: 'Empty', checklist: [{ id: 'e1', text: 'X' }] },
    ],
  }],
};
const MARKERS = {
  a: { name: 'D-10', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 1, checklistResponses: { c1: { selection: 'Pass' }, c2: { selection: 'Fail' } } },
  b: { name: 'D-2', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 2, checklistResponses: { c1: { selection: 'Pass' }, c2: { selection: 'Pass' } } },
  c: { name: 'D-3', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 1, checklistResponses: { c1: { selection: 'N/A' } } },
  d: { name: 'CAM-1', moduleId: 'mod-1', categoryId: 'cat-cam', pageNumber: 1, checklistResponses: {} },
};

test('the summary counts done, partly done, not started and issues per category', () => {
  const s = summarizeSurvey({ template: TEMPLATE, markers: MARKERS });
  assert.deepEqual(s.totals, { items: 4, done: 2, partly: 1, notStarted: 1, withIssues: 1 });
  assert.deepEqual(s.categories.map((c) => c.name), ['Door', 'Camera'], 'empty categories left out');
  assert.deepEqual(s.categories[0].issues, [{ id: 'a', name: 'D-10', lines: [{ text: 'Reader', answer: 'Fail' }] }]);
  assert.equal(summarizeSurvey({ template: TEMPLATE, markers: MARKERS, page: 2 }).totals.items, 1);
  assert.equal(summarizeSurvey({ template: TEMPLATE, markers: MARKERS, itemIds: ['c', 'd'] }).totals.items, 2);
});

test('the Summary sheet goes last, with a table per category and the issues, and survives a save', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('_SurveyMetadata', { state: 'veryHidden' });
  workbook.addWorksheet('Door - Level 1');
  const name = addSummarySheet(workbook, { template: TEMPLATE, markers: MARKERS, when: new Date(2026, 9, 21, 9, 30) });
  assert.equal(name, 'Summary');
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(back.worksheets.map((w) => w.name), ['_SurveyMetadata', 'Door - Level 1', 'Summary']);
  const rows = [];
  back.getWorksheet('Summary').eachRow((row) => rows.push(row.values.slice(1)));
  assert.deepEqual(rows[0], ['Security: summary']);
  assert.deepEqual(rows[2], ['4 items: 2 done, 1 partly done, 1 not started, 1 with issues.']);
  assert.deepEqual(rows.slice(3, 7), [
    ['Category', 'Items', 'Done', 'Partly done', 'Not started', 'With issues'],
    ['Door', 3, 2, 1, 0, 1],
    ['Camera', 1, 0, 0, 1, 0],
    ['Total', 4, 2, 1, 1, 1],
  ]);
  assert.deepEqual(rows.slice(7), [['Category', 'Item', 'Checklist line', 'Answer'], ['Door', 'D-10', 'Reader', 'Fail']]);

  const again = addSummarySheet(back, { template: TEMPLATE, markers: {} });
  assert.equal(again, 'Survey summary', 'never two sheets with one name');
});
