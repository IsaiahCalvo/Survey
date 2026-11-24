// Isaiah, Nov 24: "Mark reader 1409" got "I couldn't find an item called
// reader 1409" while tag 310H-R1409 sat on the page. A kind word and a
// number find the tag whose last number is that number and whose letters
// fit the kind (reader = R), even when the model asks find_items or
// find_on_plan instead of find_described.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readDocumentSheets } from '../src/agent/planText.js';
import { sheetFloorOf, parseDescribedTarget, scoreDescribedTag } from '../src/agent/spokenTag.js';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';

const word = (text, x, y, height = 8) => ({ text, box: { x, y, width: text.length * height * 0.6, height } });
const page = [
  ...['FOURTH', 'FLOOR', 'PLAN'].map((t, i) => word(t, 900 + i * 90, 740, 20)),
  word('310H-R1409', 300, 300), word('310H-R1408', 420, 300), word('310H-R1314', 520, 300),
  word('310H-F05-C57', 200, 120), word('04V29', 330, 380),
];

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Y' }, { value: 'N' }],
  modules: [{ id: 'mod-i', name: 'Installation', categories: [
    { id: 'cat-rdr', name: 'Card Reader', checklist: [{ id: 'i-cable', text: 'Cable Pulled' }] },
    { id: 'cat-cam', name: 'Camera', checklist: [{ id: 'c-cable', text: 'Cable Pulled' }] },
  ] }],
};

function box() {
  const doc = { getPageCount: () => 8, getPageWords: async (n) => (n === 8 ? { words: page, source: 'text' } : { words: [], source: 'none' }) };
  const bridge = {
    template: TEMPLATE,
    markers: {},
    documentId: 'doc-1',
    canEdit: true,
    currentModuleId: 'mod-i',
    readSheets: () => readDocumentSheets(doc, sheetFloorOf),
    findOnPlan: async () => ({ matches: [] }),
    getPageSize: () => ({ width: 1224, height: 792 }),
  };
  return createSurveyAgentToolbox({ getBridge: () => bridge });
}

test('reader 1409 fits 310H-R1409, not R1408 or a camera', () => {
  const target = parseDescribedTarget('reader 1409');
  assert.equal(target.kind, 'reader');
  assert.equal(target.number, 1409);
  assert.ok(scoreDescribedTag(target, '310H-R1409') > 0.5);
  assert.equal(scoreDescribedTag(target, '310H-R1408'), 0);
  assert.equal(scoreDescribedTag(target, '310H-F05-C1409'), 0);
});

test('find_described finds tag 310H-R1409 on page 8', async () => {
  const res = await box().run('find_described', { description: 'reader 1409', kind: 'reader', number: 1409, floor: null, wing: null });
  const body = JSON.parse(res.content);
  assert.deepEqual(body.plan.map((m) => [m.page, m.text]), [[8, '310H-R1409']]);
});

test('find_items with no item by that name falls back to kind and number', async () => {
  const res = await box().run('find_items', { query: 'reader 1409', category_id: null });
  assert.equal(res.isError, false, res.content);
  const body = JSON.parse(res.content);
  assert.deepEqual(body.matches, []);
  assert.deepEqual(body.by_kind_and_number.plan.map((m) => m.text), ['310H-R1409']);
});

test('find_on_plan "1409" finds the tag that ends in 1409', async () => {
  const body = JSON.parse((await box().run('find_on_plan', { text: '1409' })).content);
  assert.deepEqual(body.by_kind_and_number.plan.map((m) => m.text), ['310H-R1409']);
  // Words with no number still say nothing was found.
  const none = JSON.parse((await box().run('find_on_plan', { text: 'ACP' })).content);
  assert.deepEqual(none, { matches: [] });
});
