// Nightly 'custom-answers' / 'survey-report' (Isaiah's note, item 29): longer
// answer lists, ready line types, and the report as a CSV table.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCEL_LIST_MAX, answerSetPresets, excelValidationFor, validateAnswerSet,
} from '../src/services/answerSets.js';
import { SURVEY_REPORT_CSV_HEADER, surveyReportCsv, surveyReportCsvFileName } from '../src/services/surveyReportCsv.js';

const list = (n, name = (i) => `Answer ${i}`) => Array.from({ length: n }, (_, i) => ({ value: name(i), tone: 'neutral' }));

// Owner 2026-11-12: no upper limit on how many answers a list holds.
test('a list needs one answer and has no upper limit', () => {
  assert.deepEqual(validateAnswerSet(list(1)), []);
  assert.deepEqual(validateAnswerSet(list(40)), []);
  assert.ok(validateAnswerSet([]).length);
});

test('Excel keeps a drop-down while the list fits, else names the answers in the hint', () => {
  const short = list(8, (i) => `S${i}`);
  assert.equal(excelValidationFor({ id: 'a' }, short).type, 'list');
  const long = list(20, (i) => `Long answer name ${i}`);
  assert.ok(`"${long.map((a) => a.value).join(',')}"`.length > EXCEL_LIST_MAX);
  const rule = excelValidationFor({ id: 'a' }, long);
  assert.equal(rule.type, 'textLength');
  assert.match(rule.prompt, /^Pick one of Long answer name 0, Long answer name 1/);
  assert.ok(rule.prompt.length <= 255);
});

test('the extra presets include Yes / No / N/A in words', () => {
  const words = answerSetPresets({ extras: true }).find((p) => p.id === 'yes-no-na-words');
  assert.deepEqual(words.answers.map((a) => [a.value, a.tone]), [['Yes', 'good'], ['No', 'bad'], ['N/A', 'neutral']]);
  assert.equal(answerSetPresets().some((p) => p.id === 'yes-no-na-words'), false, 'nightly only');
});

test('the report CSV: one row per item, its status and issues, safe in a spreadsheet', () => {
  const template = {
    name: 'Fire / Life',
    modules: [{ id: 'm', name: 'M', categories: [{ id: 'c', name: 'Extinguishers', checklist: [{ id: 'a', text: 'Mounted' }, { id: 'b', text: 'Tag' }] }] }],
  };
  const markers = {
    x: { name: 'FE-2', categoryId: 'c', checklistResponses: { a: { selection: 'Y' }, b: { selection: 'N' } } },
    y: { name: '=FE-1', categoryId: 'c', checklistResponses: { a: { selection: 'Y' } } },
    z: { name: 'FE "3"', categoryId: 'c', checklistResponses: {} },
  };
  const csv = surveyReportCsv({ template, markers });
  assert.ok(csv.startsWith('﻿'));
  const rows = csv.slice(1).trim().split('\r\n');
  assert.equal(rows[0], SURVEY_REPORT_CSV_HEADER.map((h) => `"${h}"`).join(','));
  assert.deepEqual(rows.slice(1), [
    '"Extinguishers","\'=FE-1","Partly done",1,2,"","",""',
    '"Extinguishers","FE ""3""","Not started",0,2,"","",""',
    '"Extinguishers","FE-2","Done",2,2,"Tag: N","",""',
  ]);
  assert.equal(surveyReportCsvFileName(template), 'Fire Life report.csv');
});
