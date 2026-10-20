// Custom builds library, step 6: checklist answer sets beyond Y / N / N/A.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ANSWER_SET, ANSWER_SET_PRESETS, validateAnswerSet, answerSetFor,
  answerTone, isDoneAnswer, excelAnswerListFormula,
} from '../src/services/answerSets.js';

test('no answer set means today\'s Y / N / N/A, with today\'s Excel list', () => {
  const set = answerSetFor({ name: 'T' });
  assert.equal(set, DEFAULT_ANSWER_SET);
  assert.equal(excelAnswerListFormula(set), '"Y,N,N/A"');
  assert.deepEqual(['Y', 'N', 'N/A', '', undefined].map((v) => isDoneAnswer(set, v)), [true, false, true, false, false]);
});

test('every preset is valid', () => {
  ANSWER_SET_PRESETS.forEach((p) => assert.deepEqual(validateAnswerSet(p.answers), [], p.id));
});

test('a template set is used; a broken one falls back to the default', () => {
  const pass = ANSWER_SET_PRESETS.find((p) => p.id === 'pass-fail-na').answers;
  assert.equal(answerSetFor({ answerSet: pass }), pass);
  assert.equal(answerTone(pass, 'Fail'), 'bad');
  assert.equal(isDoneAnswer(pass, 'Pass'), true);
  assert.equal(isDoneAnswer(pass, 'Y'), false);
  assert.equal(answerSetFor({ answerSet: [{ value: 'a,b', tone: 'good' }, { value: 'c', tone: 'bad' }] }), DEFAULT_ANSWER_SET);
  assert.equal(answerSetFor({ answerSet: [{ value: 'Only', tone: 'good' }] }), DEFAULT_ANSWER_SET);
  assert.ok(validateAnswerSet([{ value: 'A', tone: 'good' }, { value: 'A', tone: 'bad' }]).length);
  assert.ok(validateAnswerSet([{ value: 'A', tone: 'great' }, { value: 'B', tone: 'bad' }]).length);
});

test('auto Complete entity follows the answer set', async () => {
  const { resolveAutoCompleteEntity } = await import('../src/utils/surveyAutoEntity.js');
  const pass = ANSWER_SET_PRESETS.find((p) => p.id === 'pass-fail-na').answers;
  const checklist = [{ id: 'a' }, { id: 'b' }];
  const entities = [{ id: 'e1', name: 'Complete' }];
  const yes = { a: { selection: 'Y' }, b: { selection: 'N/A' } };
  const passed = { a: { selection: 'Pass' }, b: { selection: 'N/A' } };
  assert.equal(resolveAutoCompleteEntity({ checklist, responses: yes, entities })?.id, 'e1');
  assert.equal(resolveAutoCompleteEntity({ checklist, responses: passed, entities }), null);
  assert.equal(resolveAutoCompleteEntity({ checklist, responses: passed, entities, answerSet: pass })?.id, 'e1');
  assert.equal(resolveAutoCompleteEntity({ checklist, responses: { ...passed, b: { selection: 'Fail' } }, entities, answerSet: pass }), null);
});

test('template fingerprint changes when an answer set is picked', async () => {
  const { templateFingerprint } = await import('../src/home/templatesEditorReload.js');
  const t = { name: 'Doors', modules: [], roster: [] };
  assert.equal(templateFingerprint(t), JSON.stringify(['Doors', [], []]));
  assert.notEqual(templateFingerprint({ ...t, answerSet: ANSWER_SET_PRESETS[1].answers }), templateFingerprint(t));
});

test('used-survey binding fingerprint changes when an answer set is picked', async () => {
  const { templateFingerprint, bindUsedTemplate, needsTemplateVersionChoice } = await import('../src/utils/surveyTemplateBinding.js');
  const t = { id: 't', name: 'Doors', modules: [], entities: [] };
  const withAnswers = { ...t, answerSet: ANSWER_SET_PRESETS[1].answers };
  assert.notEqual(templateFingerprint(withAnswers), templateFingerprint(t));
  assert.equal(needsTemplateVersionChoice(bindUsedTemplate(t), withAnswers), true);
});
