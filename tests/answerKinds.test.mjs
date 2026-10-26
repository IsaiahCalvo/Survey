// Nightly 'custom-answers': Score, Count and Date lines, and a fine range on
// Number lines. Every answer is still a plain string in `selection`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ANSWER_SET, itemAnswerFields, itemAnswerHint, itemAnswerSpec, itemKind, isItemDone, isItemIssue,
  excelValidationFor, typedAnswer,
} from '../src/services/answerSets.js';
import { dateAnswerOf } from '../supabase/functions/_shared/kitShape.js';

const score = { id: 's', text: 'Condition', kind: 'score', issueAt: 2 };
const score10 = { id: 's10', text: 'Finish', kind: 'score', scale: 10 };
const count = { id: 'n', text: 'Fixtures', kind: 'count', min: 2, max: 6 };
const date = { id: 'd', text: 'Expiry', kind: 'date', issueIfPast: true };
const height = { id: 'h', text: 'Height', kind: 'number', unit: 'ft', min: 7, max: 9 };

test('each kind keeps only its own clean settings', () => {
  assert.deepEqual([score, score10, count, date, height].map(itemKind), ['score', 'score', 'count', 'date', 'number']);
  assert.deepEqual(itemAnswerFields(score), { kind: 'score', scale: 5, issueAt: 2 });
  assert.deepEqual(itemAnswerFields({ kind: 'score', scale: 7, issueAt: 9, unit: 'x' }), { kind: 'score', scale: 5 });
  assert.deepEqual(itemAnswerFields({ kind: 'count', min: -1, max: 2.5 }), { kind: 'count' });
  assert.deepEqual(itemAnswerFields({ kind: 'number', unit: ' V ', min: 10, max: 5 }), { kind: 'number', unit: 'V', min: 10 });
  assert.deepEqual(itemAnswerFields({ kind: 'date', issueIfPast: 'yes' }), { kind: 'date' });
  assert.deepEqual(itemAnswerFields({ kind: 'photo' }), {});
  assert.deepEqual(itemAnswerSpec(count), { answer_kind: 'count', min: 2, max: 6 });
  assert.deepEqual(itemAnswerSpec({ id: 'p' }), {});
});

test('answers are saved clean, or refused when they do not fit', () => {
  assert.equal(typedAnswer(score, ' 3 '), '3');
  assert.equal(typedAnswer(score, '6'), null);
  assert.equal(typedAnswer(score, '2.5'), null);
  assert.equal(typedAnswer(score10, '10'), '10');
  assert.equal(typedAnswer(count, '0'), '0');
  assert.equal(typedAnswer(count, '-1'), null);
  assert.equal(typedAnswer(count, '1,000'), '1000');
  assert.equal(typedAnswer(date, '2026-10-22'), '2026-10-22');
  assert.equal(typedAnswer(date, '10/22/2026'), '2026-10-22');
  assert.equal(typedAnswer(date, '2026-02-30'), null);
  assert.equal(typedAnswer(date, 'soon'), null);
  assert.equal(typedAnswer(date, ''), '');
  assert.equal(dateAnswerOf(new Date('2026-10-22T00:00:00Z')), '2026-10-22');
});

test('done once answered; an issue past the line the item sets', () => {
  const today = '2026-10-23';
  assert.equal(isItemDone(score, DEFAULT_ANSWER_SET, '1'), true);
  assert.equal(isItemDone(count, DEFAULT_ANSWER_SET, '0'), true);
  assert.equal(isItemDone(date, DEFAULT_ANSWER_SET, ''), false);
  assert.equal(isItemDone(score, DEFAULT_ANSWER_SET, '9'), false, 'off the scale is not an answer');
  assert.equal(isItemIssue(score, DEFAULT_ANSWER_SET, '2', today), true);
  assert.equal(isItemIssue(score, DEFAULT_ANSWER_SET, '3', today), false);
  assert.equal(isItemIssue(score10, DEFAULT_ANSWER_SET, '1', today), false, 'no issue line set');
  assert.equal(isItemIssue(count, DEFAULT_ANSWER_SET, '1', today), true);
  assert.equal(isItemIssue(count, DEFAULT_ANSWER_SET, '7', today), true);
  assert.equal(isItemIssue(count, DEFAULT_ANSWER_SET, '4', today), false);
  assert.equal(isItemIssue(height, DEFAULT_ANSWER_SET, '9.5', today), true);
  assert.equal(isItemIssue(height, DEFAULT_ANSWER_SET, '', today), false);
  assert.equal(isItemIssue(date, DEFAULT_ANSWER_SET, '2026-10-22', today), true);
  assert.equal(isItemIssue(date, DEFAULT_ANSWER_SET, '2026-10-23', today), false);
  assert.equal(isItemIssue({ kind: 'date' }, DEFAULT_ANSWER_SET, '2020-01-01', today), false);
});

test('a hint says what each line asks for', () => {
  assert.equal(itemAnswerHint(score), 'Score 1-5; 2 or lower is an issue');
  assert.equal(itemAnswerHint(count), 'Count; fine from 2 to 6');
  assert.equal(itemAnswerHint(height), 'Number in ft; fine from 7 to 9');
  assert.equal(itemAnswerHint(date), 'Date; an issue once it has passed');
  assert.equal(itemAnswerHint({ kind: 'text' }), '');
});

test('Excel: a rule and a hint per kind; cells are real numbers and dates, read back as text', async () => {
  const s = excelValidationFor(score, DEFAULT_ANSWER_SET);
  assert.deepEqual([s.type, s.operator, s.formulae], ['whole', 'between', [1, 5]]);
  assert.equal(s.prompt, 'Score 1-5; 2 or lower is an issue');
  assert.deepEqual(excelValidationFor(score10, DEFAULT_ANSWER_SET).formulae, [1, 10]);
  assert.deepEqual(excelValidationFor(count, DEFAULT_ANSWER_SET).formulae, [0, 1e9]);
  assert.equal(excelValidationFor(date, DEFAULT_ANSWER_SET).type, 'date');
  assert.equal(excelValidationFor({ kind: 'number' }, DEFAULT_ANSWER_SET).showInputMessage, undefined, 'a plain Number line keeps its old rule');

  const { buildSheetRow, excelCellAnswer } = await import('../src/services/exportFormats/sheetLayout.js');
  const kit = { columns: [{ field: 'checklist' }] };
  const row = buildSheetRow(kit, [score, count, date], {}, { s: '3', n: '4', d: '2026-10-22' });
  assert.deepEqual(row.slice(0, 2), [3, 4]);
  assert.ok(row[2] instanceof Date);
  assert.equal(row[2].toISOString(), '2026-10-22T00:00:00.000Z');
  assert.deepEqual(row.map(excelCellAnswer), ['3', '4', '2026-10-22']);
  assert.equal(excelCellAnswer('Y'), 'Y');
  assert.equal(excelCellAnswer(null), null);
});

test('the template version changes with a kind setting; text and number prints stay as before', async () => {
  const { templateFingerprint } = await import('../src/home/templatesEditorReload.js');
  const t = (item) => ({ name: 'T', modules: [{ id: 'm', name: 'M', categories: [{ id: 'c', name: 'C', items: [{ id: 'i', text: 'x', ...item }] }] }], roster: [] });
  assert.notEqual(templateFingerprint(t({ kind: 'score' })), templateFingerprint(t({ kind: 'score', issueAt: 2 })));
  assert.notEqual(templateFingerprint(t({ kind: 'count' })), templateFingerprint(t({ kind: 'number' })));
  assert.match(templateFingerprint(t({ kind: 'number', unit: 'ft' })), /\["kind","number","ft"\]/);
});

test('the survey agent sees each line\'s settings and is held to them', async () => {
  const { createSurveyAgentToolbox } = await import('../src/agent/surveyAgentTools.js');
  const template = {
    name: 'Fire',
    modules: [{ id: 'm', name: 'Inspection', categories: [{ id: 'ext', name: 'Extinguisher', checklist: [{ id: 'ok', text: 'Mounted' }, score, count, date] }] }],
  };
  const markers = { x: { name: 'FE-1', moduleId: 'm', categoryId: 'ext', checklistResponses: {} } };
  const bridge = {
    template, markers, documentId: 'doc', canEdit: true, selectedMarkerId: null,
    setAnswers: (id, answers) => {
      const responses = { ...markers[id].checklistResponses };
      for (const a of answers) responses[a.checklistItemId] = { selection: a.value };
      markers[id] = { ...markers[id], checklistResponses: responses };
    },
  };
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const ctx = JSON.parse((await box.run('get_survey_context', {})).content);
  assert.deepEqual(ctx.categories[0].checklist.map(({ id, text, ...spec }) => spec), [
    {}, { answer_kind: 'score', scale: 5, issueAt: 2 }, { answer_kind: 'count', min: 2, max: 6 }, { answer_kind: 'date', issueIfPast: true },
  ]);
  const bad = await box.run('set_answers', { item_id: 'x', answers: [{ checklist_item_id: 's', value: '7' }] });
  assert.equal(bad.isError, true);
  assert.match(bad.content, /does not fit "Condition": Score 1-5/);
  const ok = await box.run('set_answers', {
    item_id: 'x',
    all_lines: 'Y',
    answers: [{ checklist_item_id: 's', value: '4' }, { checklist_item_id: 'n', value: '3' }, { checklist_item_id: 'd', value: '10/22/2027' }],
  });
  assert.equal(ok.isError, false);
  assert.deepEqual(Object.fromEntries(Object.entries(markers.x.checklistResponses).map(([k, v]) => [k, v.selection])), {
    s: '4', n: '3', d: '2027-10-22', ok: 'Y',
  });
});
