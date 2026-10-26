// Nightly 'survey-report': the PowerPoint survey report.
import test from 'node:test';
import assert from 'node:assert/strict';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import {
  buildSurveyReport, surveyReportFileName, surveyReportPlan,
} from '../src/services/surveyReportPptx.js';

const template = {
  name: 'Door Hardware',
  answerSet: [{ value: 'Pass', tone: 'good' }, { value: 'Fail', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
  modules: [{ id: 'm', name: 'Installation', categories: [
    { id: 'door', name: 'Door', checklist: [{ id: 'a', text: 'Lock works' }, { id: 'h', text: 'Height', kind: 'number', unit: 'ft' }] },
    { id: 'cam', name: 'Camera', checklist: [{ id: 'c', text: 'Aimed' }] },
    { id: 'empty', name: 'Unused', checklist: [{ id: 'z', text: 'Z' }] },
  ] }],
};
const marker = (name, categoryId, responses) => ({ name, moduleId: 'm', categoryId, checklistResponses: Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, { selection: v }])) });

test('the plan holds the totals, a chart row per used category and the issues', () => {
  const markers = {
    d1: marker('D-1', 'door', { a: 'Pass', h: '8' }),
    d2: marker('D-2', 'door', { a: 'Fail', h: '7' }),
    d3: marker('D-3', 'door', { a: 'Pass' }),
    c1: marker('C-1', 'cam', {}),
  };
  const plan = surveyReportPlan({ template, markers, documentName: 'L2.pdf', when: new Date('2026-10-22T12:00:00') });
  assert.equal(plan.title, 'Door Hardware report');
  assert.match(plan.subtitle, /^L2\.pdf · /);
  assert.deepEqual(plan.tiles.map((t) => t.value), [4, 2, 1, 1, 1]);
  assert.deepEqual(plan.chart.categories, ['Door', 'Camera']);
  assert.deepEqual(plan.chart.series.map((s) => s.values), [[2, 0], [1, 0], [0, 1]]);
  assert.deepEqual(plan.issueRows, [{ category: 'Door', item: 'D-2', lines: 'Lock works: Fail' }]);
});

const slideFiles = (zip) => Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
const build = async (t, markers) => JSZip.loadAsync(await buildSurveyReport(PptxGenJS, { template: t, markers }).write({ outputType: 'nodebuffer' }));

test('issues split over slides by height; the deck is a real PowerPoint file', async () => {
  const markers = {};
  for (let i = 0; i < 30; i++) markers[`d${i}`] = marker(`D-${i}`, 'door', { a: 'Fail' });
  assert.equal(surveyReportPlan({ template, markers }).issueRows.length, 30);
  const zip = await build(template, markers);
  // Cover, progress, by category, then the issues table over more than one slide.
  assert.ok(slideFiles(zip).length >= 5, `got ${slideFiles(zip).length} slides`);
  assert.ok(Object.keys(zip.files).some((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f)), 'a native chart');
});

test('one item with very many problem lines carries on to the next slide', async () => {
  const checklist = Array.from({ length: 80 }, (_, i) => ({ id: `q${i}`, text: `Check number ${i} on the door frame and closer` }));
  const big = { ...template, modules: [{ id: 'm', name: 'Installation', categories: [{ id: 'door', name: 'Door', checklist }] }] };
  const zip = await build(big, { d: marker('D-1', 'door', Object.fromEntries(checklist.map((c) => [c.id, 'Fail']))) });
  assert.ok(slideFiles(zip).length >= 5, `got ${slideFiles(zip).length} slides`);
});

test('an empty survey still makes a deck, and file names are safe', async () => {
  const buffer = await buildSurveyReport(PptxGenJS, { template, markers: {} }).write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(buffer);
  assert.equal(Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length, 3);
  assert.equal(surveyReportFileName({ name: 'A/B: "C"' }), 'A B C report.pptx');
  assert.equal(surveyReportFileName(null), 'Survey report.pptx');
});
