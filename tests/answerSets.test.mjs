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
  assert.equal(answerSetFor({ answerSet: [] }), DEFAULT_ANSWER_SET);
  const many = (n) => Array.from({ length: n }, (_, i) => ({ value: `A${i}`, tone: 'good' }));
  assert.equal(answerSetFor({ answerSet: many(20) }).length, 20);
  assert.equal(answerSetFor({ answerSet: many(21) }), DEFAULT_ANSWER_SET);
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

test('a kit can carry the answer set; the template\'s own set still wins', async () => {
  const { registerExportKit, getExportKit } = await import('../src/services/exportFormats/registry.js');
  const { answerSetFor, DEFAULT_ANSWER_SET } = await import('../src/services/answerSets.js');
  const passFail = [{ value: 'Pass', tone: 'good' }, { value: 'Fail', tone: 'bad' }];
  const off = registerExportKit({ ...getExportKit('wireless-lock-schedule'), id: 'kit-answers-test', answerSet: passFail });
  assert.deepEqual(answerSetFor({ exportKitId: 'kit-answers-test' }).map((a) => a.value), ['Pass', 'Fail']);
  const own = [{ value: 'Ok', tone: 'good' }, { value: 'Bad', tone: 'bad' }];
  assert.equal(answerSetFor({ exportKitId: 'kit-answers-test', answerSet: own }), own);
  assert.equal(answerSetFor({ exportKitId: 'wireless-lock-schedule' }), DEFAULT_ANSWER_SET);
  off();
  const offBad = registerExportKit({ ...getExportKit('wireless-lock-schedule'), id: 'kit-answers-bad', answerSet: [{ value: 'a,b', tone: 'good' }] });
  assert.equal(answerSetFor({ exportKitId: 'kit-answers-bad' }), DEFAULT_ANSWER_SET);
  offBad();
  assert.equal(answerSetFor({ exportKitId: 'kit-answers-test' }), DEFAULT_ANSWER_SET);
});

test('make-your-own lists: one answer is a plain "Done"; 5 / 10 / 20 works', () => {
  const done = [{ value: 'Done', tone: 'good' }];
  assert.equal(answerSetFor({ answerSet: done }), done);
  assert.equal(excelAnswerListFormula(done), '"Done"');
  const sizes = [{ value: '5', tone: 'neutral' }, { value: '10', tone: 'neutral' }, { value: '20', tone: 'neutral' }];
  assert.equal(answerSetFor({ answerSet: sizes }), sizes);
  assert.equal(excelAnswerListFormula(sizes), '"5,10,20"');
  assert.equal(isDoneAnswer(sizes, '10'), true);
});

test('extra presets are valid and only offered with the flag', async () => {
  const { EXTRA_ANSWER_SET_PRESETS, answerSetPresets, answerPresetIdOf } = await import('../src/services/answerSets.js');
  EXTRA_ANSWER_SET_PRESETS.forEach((p) => assert.deepEqual(validateAnswerSet(p.answers), [], p.id));
  assert.equal(answerSetPresets(), ANSWER_SET_PRESETS);
  assert.equal(answerSetPresets({ extras: true }).length, ANSWER_SET_PRESETS.length + EXTRA_ANSWER_SET_PRESETS.length);
  const ids = answerSetPresets({ extras: true }).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const sml = EXTRA_ANSWER_SET_PRESETS.find((p) => p.id === 'small-medium-large').answers;
  assert.equal(answerPresetIdOf(undefined), 'yes-no-na');
  assert.equal(answerPresetIdOf(sml), '');
  assert.equal(answerPresetIdOf(sml, answerSetPresets({ extras: true })), 'small-medium-large');
  assert.equal(answerPresetIdOf([{ value: 'Ok', tone: 'good' }], answerSetPresets({ extras: true })), '');
});

test('a typed-in list is saved only when usable, with a plain reason when not', async () => {
  const { cleanAnswerSet, answerSetProblem, sameAnswerSet } = await import('../src/services/answerSets.js');
  assert.deepEqual(cleanAnswerSet([{ value: ' Small ', tone: 'neutral', extra: 1 }]), [{ value: 'Small', tone: 'neutral' }]);
  assert.equal(cleanAnswerSet([{ value: '', tone: 'good' }]), null);
  assert.equal(cleanAnswerSet([]), null);
  assert.equal(answerSetProblem([]), 'Add at least one answer.');
  assert.equal(answerSetProblem([{ value: ' ', tone: 'good' }]), 'Every answer needs a name.');
  assert.match(answerSetProblem([{ value: 'a,b', tone: 'good' }]), /commas/);
  assert.match(answerSetProblem([{ value: 'x'.repeat(21), tone: 'good' }]), /20 characters/);
  assert.equal(answerSetProblem([{ value: 'A', tone: 'good' }, { value: 'A ', tone: 'bad' }]), 'Two answers have the same name.');
  assert.equal(answerSetProblem([{ value: 'A', tone: 'good' }]), '');
  assert.equal(sameAnswerSet([{ value: 'A', tone: 'good' }], [{ value: 'A', tone: 'good' }]), true);
  assert.equal(sameAnswerSet([{ value: 'A', tone: 'good' }], [{ value: 'A', tone: 'bad' }]), false);
});

test("'custom-answers' is a beta flag (nightly only) with a migration row", async () => {
  const { FEATURE_FLAGS } = await import('../src/featureFlags.js');
  assert.equal(FEATURE_FLAGS['custom-answers']?.stage, 'beta');
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  assert.match(sql, /\('custom-answers', 'off'/);
});

test('text and number items: saved answer, done, issue and Excel rule', async () => {
  const { itemKind, typedAnswer, isItemDone, isItemIssue, excelValidationFor, excelAnswerFills, templateHasTypedItems } = await import('../src/services/answerSets.js');
  const text = { id: 'a', text: 'Serial', kind: 'text' };
  const num = { id: 'b', text: 'Height', kind: 'number', unit: 'ft' };
  const pick = { id: 'c', text: 'Installed' };
  assert.deepEqual([text, num, pick, { kind: 'video' }].map(itemKind), ['text', 'number', 'choice', 'choice']);
  assert.equal(typedAnswer(text, '  SN-1 '), 'SN-1');
  assert.equal(typedAnswer(num, '1,200'), '1200');
  assert.equal(typedAnswer(num, ' 8.5 '), '8.5');
  assert.equal(typedAnswer(num, 'eight'), null);
  assert.equal(typedAnswer(num, ''), '');
  assert.equal(isItemDone(text, DEFAULT_ANSWER_SET, 'N'), true);
  assert.equal(isItemDone(num, DEFAULT_ANSWER_SET, ''), false);
  assert.equal(isItemDone(pick, DEFAULT_ANSWER_SET, 'N'), false);
  assert.equal(isItemIssue(text, DEFAULT_ANSWER_SET, 'N'), false);
  assert.equal(isItemIssue(pick, DEFAULT_ANSWER_SET, 'N'), true);
  assert.equal(excelValidationFor(text, DEFAULT_ANSWER_SET), null);
  assert.equal(excelValidationFor(num, DEFAULT_ANSWER_SET).type, 'decimal');
  assert.match(excelValidationFor(num, DEFAULT_ANSWER_SET).error, /\(ft\)/);
  // Pick-one keeps today's exact rule.
  assert.deepEqual(excelValidationFor(pick, DEFAULT_ANSWER_SET), {
    type: 'list', allowBlank: true, formulae: ['"Y,N,N/A"'], showErrorMessage: true,
    errorStyle: 'error', errorTitle: 'Invalid selection', error: 'Please select Y, N, or N/A',
  });
  assert.deepEqual(excelAnswerFills(DEFAULT_ANSWER_SET), [
    { value: 'Y', argb: 'FFCEEED0' }, { value: 'N', argb: 'FFF6C9CE' }, { value: 'N/A', argb: 'FFA6A6A6' },
  ]);
  const tpl = (items) => ({ modules: [{ categories: [{ checklist: items }] }] });
  assert.equal(templateHasTypedItems(tpl([pick])), false);
  assert.equal(templateHasTypedItems(tpl([pick, num])), true);
});

test('auto Complete waits for text and number items to be filled', async () => {
  const { resolveAutoCompleteEntity } = await import('../src/utils/surveyAutoEntity.js');
  const checklist = [{ id: 'a' }, { id: 'b', kind: 'number' }];
  const entities = [{ id: 'e1', name: 'Complete' }];
  assert.equal(resolveAutoCompleteEntity({ checklist, responses: { a: { selection: 'Y' } }, entities }), null);
  assert.equal(resolveAutoCompleteEntity({ checklist, responses: { a: { selection: 'Y' }, b: { selection: '8' } }, entities })?.id, 'e1');
});

test('summary never counts a typed answer as an issue', async () => {
  const { summarizeSurvey } = await import('../src/services/surveySummary.js');
  const template = { modules: [{ id: 'm', categories: [{ id: 'c', name: 'Doors', checklist: [{ id: 'a', text: 'Serial', kind: 'text' }, { id: 'b', text: 'Hung' }] }] }] };
  const markers = { x: { name: 'D-1', categoryId: 'c', checklistResponses: { a: { selection: 'N' }, b: { selection: 'N' } } } };
  const s = summarizeSurvey({ template, markers });
  assert.deepEqual(s.categories[0].issues[0].lines.map((l) => l.text), ['Hung']);
});

test('template fingerprint and the agent tool schema follow item kinds', async () => {
  const { templateFingerprint } = await import('../src/home/templatesEditorReload.js');
  const t = (kind) => ({ name: 'T', modules: [{ id: 'm', name: 'M', categories: [{ id: 'c', name: 'C', items: [{ id: 'i', text: 'x', ...(kind ? { kind } : {}) }] }] }], roster: [] });
  assert.notEqual(templateFingerprint(t('number')), templateFingerprint(t()));
  const { buildSurveyAgentTools } = await import('../supabase/functions/_shared/surveyAgentSpec.js');
  const valueOf = (opts) => buildSurveyAgentTools(['Y', 'N', 'N/A'], opts).find((x) => x.function.name === 'set_answers')
    .function.parameters.properties.answers.items.properties.value;
  assert.deepEqual(valueOf().enum, ['Y', 'N', 'N/A']);
  assert.equal(valueOf({ typedLines: true }).enum, undefined);
});

test('a number read back from Excel (10) still matches the answer "10"', async () => {
  const { answerTone, isDoneAnswer, sameAnswer } = await import('../src/services/answerSets.js');
  const sizes = [{ value: '5', tone: 'neutral' }, { value: '10', tone: 'bad' }];
  assert.equal(answerTone(sizes, 10), 'bad');
  assert.equal(isDoneAnswer(sizes, 5), true);
  assert.equal(sameAnswer(undefined, 'undefined'), false);
  assert.equal(isDoneAnswer(DEFAULT_ANSWER_SET, undefined), false);
});

test('a Number line goes to Excel as a real number; other answers stay text', async () => {
  const { buildSheetRow } = await import('../src/services/exportFormats/sheetLayout.js');
  const kit = { columns: [{ field: 'name' }, { field: 'checklist' }] };
  const items = [{ id: 'h', kind: 'number' }, { id: 't', kind: 'text' }, { id: 'c' }, { id: 'e', kind: 'number' }];
  assert.deepEqual(buildSheetRow(kit, items, { name: 'D-1' }, { h: '1200', t: '42', c: '10', e: '' }), ['D-1', 1200, '42', '10', '']);
});

test('an answer can carry a "means" line: kept, checked, shown, read by Excel and the agent', async () => {
  const {
    cleanAnswerSet, answerSetProblem, sameAnswerSet, answerMeans, excelValidationFor, answerPresetIdOf, ANSWER_MEANS_MAX,
  } = await import('../src/services/answerSets.js');
  const { answerSetMeaning } = await import('../supabase/functions/_shared/surveyAgentMeaning.js');
  const { templateFingerprint } = await import('../src/home/templatesEditorReload.js');
  const draft = [
    { value: 'Pass', tone: 'good', means: '  works on first try ' },
    { value: 'Fail', tone: 'bad', means: '' },
  ];
  const set = cleanAnswerSet(draft);
  assert.deepEqual(set, [{ value: 'Pass', tone: 'good', means: 'works on first try' }, { value: 'Fail', tone: 'bad' }]);
  assert.deepEqual(validateAnswerSet(set), []);
  assert.notEqual(validateAnswerSet([{ value: 'Pass', tone: 'good', means: 5 }]).length, 0);
  assert.match(answerSetProblem([{ value: 'Pass', tone: 'good', means: 'x'.repeat(ANSWER_MEANS_MAX + 1) }]), /meaning/);
  assert.equal(sameAnswerSet(set, cleanAnswerSet([{ value: 'Pass', tone: 'good' }, { value: 'Fail', tone: 'bad' }])), false);
  assert.equal(answerPresetIdOf([{ value: 'Y', tone: 'good', means: 'in' }, { value: 'N', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }]), '');
  assert.equal(answerMeans(set, 'Pass'), 'works on first try');
  assert.equal(answerMeans(set, 'Fail'), '');
  assert.equal(answerMeans(set, undefined), '');

  // Excel: the cell's hint lists the meanings; no meanings, no hint (today's file).
  const rule = excelValidationFor({ text: 'Lock' }, set);
  assert.equal(rule.showInputMessage, true);
  assert.equal(rule.prompt, 'Pass: works on first try');
  assert.equal(excelValidationFor({ text: 'Lock' }, DEFAULT_ANSWER_SET).showInputMessage, undefined);

  // The agent hears the template's own meaning, even on Y / N / N/A.
  assert.match(answerSetMeaning(set), /"Pass" for works on first try/);
  assert.equal(answerSetMeaning(DEFAULT_ANSWER_SET), null);
  assert.match(answerSetMeaning([{ value: 'Y', tone: 'good', means: 'fully in' }, { value: 'N', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }]), /fully in/);

  // Editing only a meaning still marks the template as changed.
  const tpl = (answerSet) => ({ id: 't', name: 'T', modules: [], answerSet });
  assert.notEqual(templateFingerprint(tpl(set)), templateFingerprint(tpl(set.map(({ means: _m, ...a }) => a))));
});
