// Conditional lines (Nightly beta 'conditional-lines', kept hidden): a line
// shows only once another line has a certain answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answerIs, showIfChoices, showIfOf, shownChecklist } from '../src/services/conditionalLines.js';
import { isChecklistAllYesOrNA } from '../src/utils/surveyAutoEntity.js';
import { isFeatureOn } from '../src/featureFlags.js';
import { fingerprintTemplates } from '../src/home/templatesEditorReload.js';

const LINES = [
  { id: 'proto', text: 'Protocol', kind: 'many', options: [{ value: 'Wiegand', tone: 'neutral' }, { value: 'OSDP', tone: 'neutral' }] },
  { id: 'addr', text: 'Address', kind: 'text', showIf: { itemId: 'proto', value: 'OSDP' } },
  { id: 'baud', text: 'Baud rate', kind: 'text', showIf: { itemId: 'addr', value: '1' } },
  { id: 'reader', text: 'Reader mounted' },
];
const ids = (list) => list.map((l) => l.id);

test('a line shows once the line it names has that answer, and lines under it follow', () => {
  assert.deepEqual(ids(shownChecklist(LINES, {})), ['proto', 'reader']);
  assert.deepEqual(ids(shownChecklist(LINES, { proto: { selection: 'Wiegand' } })), ['proto', 'reader']);
  assert.deepEqual(ids(shownChecklist(LINES, { proto: { selection: 'Wiegand, OSDP' } })), ['proto', 'addr', 'reader']);
  assert.deepEqual(ids(shownChecklist(LINES, { proto: { selection: 'OSDP' }, addr: { selection: '1' } })), ['proto', 'addr', 'baud', 'reader']);
  // Protocol changed back: Address hides, and Baud rate under it too.
  assert.deepEqual(ids(shownChecklist(LINES, { proto: { selection: 'Wiegand' }, addr: { selection: '1' } })), ['proto', 'reader']);
  // Off: every active line, as before.
  assert.deepEqual(ids(shownChecklist(LINES, {}, { on: false })), ['proto', 'addr', 'baud', 'reader']);
});

test('a condition nothing can meet shows the line: gone, archived, itself, a loop', () => {
  const lines = [
    { id: 'a', text: 'A', showIf: { itemId: 'gone', value: 'Y' } },
    { id: 'b', text: 'B', showIf: { itemId: 'old', value: 'Y' } },
    { id: 'old', text: 'Old', archived: true },
    { id: 'c', text: 'C', showIf: { itemId: 'c', value: 'Y' } },
    { id: 'd', text: 'D', showIf: { itemId: 'e', value: 'Y' } },
    { id: 'e', text: 'E', showIf: { itemId: 'd', value: 'Y' } },
  ];
  assert.deepEqual(ids(shownChecklist(lines, {})), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(showIfOf(lines[3]), null);
});

test('pick-one answers match without case; a blank never matches', () => {
  assert.equal(answerIs({ id: 'x' }, 'n/a', 'N/A'), true);
  assert.equal(answerIs({ id: 'x' }, '', 'N/A'), false);
  assert.equal(answerIs({ id: 'x' }, undefined, 'Y'), false);
});

test('a hidden line does not hold back Complete', () => {
  const responses = { proto: { selection: 'Wiegand' }, reader: { selection: 'Y' } };
  assert.equal(isChecklistAllYesOrNA(LINES, responses), false);
  assert.equal(isChecklistAllYesOrNA(shownChecklist(LINES, responses), responses), true);
});

test('the editor offers each answer of pick-one and Pick many lines above', () => {
  const answersOf = (line) => (line.kind === 'many' ? line.options : [{ value: 'Y' }, { value: 'N' }]);
  const choices = showIfChoices(LINES, 'baud', answersOf);
  assert.deepEqual(choices.map((c) => c.label), ['When "Protocol" is Wiegand', 'When "Protocol" is OSDP']);
  assert.deepEqual(showIfChoices(LINES, 'proto', answersOf), []);
});

test('hidden flag: Survey Nightly does not turn it on by itself', () => {
  const storage = (v) => ({ getItem: (k) => (k === 'survey.flag.conditional-lines' ? v : null) });
  const nightly = { VITE_RELEASE_CHANNEL: 'nightly' };
  assert.equal(isFeatureOn('conditional-lines', { storage: storage(null), env: nightly }), false);
  assert.equal(isFeatureOn('conditional-lines', { storage: storage('1'), env: nightly }), true);
  assert.equal(isFeatureOn('custom-answers', { storage: storage(null), env: nightly }), true);
  assert.equal(isFeatureOn('conditional-lines', { storage: storage('1'), env: {} }), false, 'never on stable');
  const sql = readFileSync(new URL('../supabase/migrations/20261027232000_conditional_lines_flag.sql', import.meta.url), 'utf8');
  assert.match(sql, /'conditional-lines', 'off'/);
});

test('the editor counts a condition as a change, and the save keeps it', () => {
  const tpl = (showIf) => [{ id: 't', name: 'T', modules: [{ id: 'm', name: 'M', categories: [{ id: 'c', name: 'C', items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B', ...(showIf ? { showIf } : {}) }] }] }] }];
  const maps = { roleColors: {}, borderColors: {}, matchFill: {} };
  assert.notEqual(fingerprintTemplates(tpl(null), maps).t, fingerprintTemplates(tpl({ itemId: 'a', value: 'Y' }), maps).t);
  const editor = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');
  assert.equal((editor.match(/if \(showIfOf\(it\)\) (base|out)\.showIf = showIfOf\(it\);/g) || []).length, 2, 'loaded and saved');
});
