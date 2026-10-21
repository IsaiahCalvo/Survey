import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsCover,
  findTagInDocument,
  findTagOnPages,
  markerBoxAroundTag,
  ocrWordsToWords,
  textItemsToWords,
} from '../src/agent/planText.js';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';

// pdf.js viewport at scale 1 on an unrotated 792 x 612 page: y flips.
const viewport = { convertToViewportPoint: (x, y) => [x, 612 - y] };
const item = (str, x, y, width, size = 8) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size });

test('text items become words with page boxes, split by character', () => {
  const words = textItemsToWords([item('DOOR D-117', 100, 500, 100), item('  ', 0, 0, 5)], viewport);
  assert.deepEqual(words.map((w) => w.text), ['DOOR', 'D-117']);
  assert.deepEqual(words[1].box, { x: 150, y: 104, width: 50, height: 8 });
});

test('on a page turned 90 degrees, words run down the sheet and still join into a tag', () => {
  // pdf.js viewport for /Rotate 90 on a 612 x 792 sheet, at scale 1.
  const turned = { convertToViewportPoint: (x, y) => [y, x] };
  const words = textItemsToWords([item('PAGE 2 D- 117', 28, 760, 78, 10)], turned);
  assert.deepEqual(words[0].box, { x: 760, y: 28, width: 10, height: 24 });
  const [match] = findTagOnPages('D-117', [{ page: 2, words }]);
  assert.equal(match.text, 'D- 117');
  assert.deepEqual(match.box, { x: 760, y: 70, width: 10, height: 36 });
});

test('a tag is found whole, joined across words, never inside a longer tag', () => {
  const page = (words) => [{ page: 3, words }];
  const w = (text, x, y = 100, width = 20) => ({ text, box: { x, y, width, height: 8 } });
  assert.equal(findTagOnPages('D-117', page([w('D-117', 10)])).length, 1);
  assert.equal(findTagOnPages('d117', page([w('D-117,', 10)])).length, 1);
  const split = findTagOnPages('D-117', page([w('D-', 10, 100, 8), w('117', 20, 100, 14)]));
  assert.equal(split.length, 1);
  assert.deepEqual(split[0].box, { x: 10, y: 100, width: 24, height: 8 });
  assert.equal(findTagOnPages('D-117', page([w('D-1170', 10)])).length, 0);
  assert.equal(findTagOnPages('D-117', page([w('D-', 10), w('117', 300)])).length, 0, 'far apart is two labels');
  assert.equal(findTagOnPages('D-117', page([w('D-', 10, 100), w('117', 32, 300)])).length, 0, 'other line');
  assert.equal(findTagOnPages('x', page([w('X', 10)])).length, 0, 'too short to search');
});

test('text recognition words and marker boxes', () => {
  const words = ocrWordsToWords([{ text: 'D-118', quad: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 28 }, { x: 10, y: 28 }] }, { text: ' ' }]);
  assert.deepEqual(words, [{ text: 'D-118', box: { x: 10, y: 20, width: 30, height: 8 } }]);
  const box = markerBoxAroundTag({ x: 100, y: 100, width: 24, height: 8 }, { width: 792, height: 612 });
  assert.ok(box.width >= 24 && box.height >= 24);
  assert.ok(boundsCover(box, { x: 100, y: 100, width: 24, height: 8 }));
  const corner = markerBoxAroundTag({ x: 0, y: 0, width: 10, height: 8 }, { width: 792, height: 612 });
  assert.equal(corner.x, 0);
  assert.equal(corner.y, 0);
});

test('a document search reads each page once and reports pages with no text', async () => {
  let reads = 0;
  const doc = {
    getPageCount: () => 3,
    getPageWords: async (page) => {
      reads += 1;
      if (page === 2) return { words: [], source: 'none' };
      return { words: page === 3 ? [{ text: 'D-119', box: { x: 1, y: 1, width: 20, height: 8 } }] : [], source: 'text' };
    },
  };
  const first = await findTagInDocument(doc, 'D-119');
  assert.deepEqual(first.matches.map((m) => m.page), [3]);
  assert.deepEqual(first.unreadPages, [2]);
  await findTagInDocument(doc, 'D-119');
  assert.equal(reads, 4, 'only the unread page is asked again');
});

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Y' }, { value: 'N' }],
  entities: [{ id: 'ent-sub', name: 'Subcontractor', color: '#00a' }],
  modules: [{ id: 'mod-1', name: 'Level 1', categories: [{ id: 'cat-door', name: 'Door', checklist: [{ id: 'chk-lock', text: 'Lock' }] }] }],
};

function planBridge(overrides = {}) {
  const markers = {
    m118: { name: 'D-118', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 2, bounds: { x: 100, y: 90, width: 50, height: 30 }, checklistResponses: {} },
  };
  const created = [];
  const deleted = [];
  const bridge = {
    template: TEMPLATE,
    markers,
    documentId: 'doc-1',
    canEdit: true,
    findOnPlan: async (text) => ({
      matches: findTagOnPages(text, [{ page: 2, words: [
        { text: 'D-118', box: { x: 110, y: 100, width: 24, height: 8 } },
        { text: 'D-119', box: { x: 300, y: 100, width: 24, height: 8 } },
      ] }]),
      unreadPages: [5],
    }),
    getPageSize: () => ({ width: 792, height: 612 }),
    createItem: (spec) => {
      created.push(spec);
      const id = `new-${created.length}`;
      markers[id] = { name: spec.name, moduleId: spec.moduleId, categoryId: spec.categoryId, entityId: spec.entityId, pageNumber: spec.page, bounds: spec.bounds, checklistResponses: {} };
      return id;
    },
    deleteMarker: (id) => { deleted.push(id); delete markers[id]; },
    setAnswers: (id, answers) => {
      for (const a of answers) markers[id].checklistResponses[a.checklistItemId] = { selection: a.value };
    },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], ...snap }; },
    ...overrides,
  };
  return { bridge, markers, created, deleted };
}

test('find_on_plan returns match ids and marks a tag that is already an item', async () => {
  const { bridge } = planBridge();
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const known = JSON.parse((await box.run('find_on_plan', { text: 'D-118' })).content);
  assert.deepEqual(known.matches[0].already_item, { id: 'm118', name: 'D-118' });
  assert.equal(known.pages_without_text, 1);
  const fresh = JSON.parse((await box.run('find_on_plan', { text: 'D 119' })).content);
  assert.equal(fresh.matches.length, 1);
  assert.equal(fresh.matches[0].page, 2);
  assert.equal(fresh.matches[0].already_item, undefined);
  assert.notEqual(fresh.matches[0].id, known.matches[0].id);
  assert.equal((await box.run('find_on_plan', { text: '-' })).isError, true);
});

test('create_item adds the tag as an item on its spot, once, and undo removes it while untouched', async () => {
  const { bridge, markers, created, deleted } = planBridge();
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const { matches } = JSON.parse((await box.run('find_on_plan', { text: 'D-119' })).content);
  assert.equal((await box.run('create_item', { name: 'D-119', category_id: 'cat-nope', plan_match_id: matches[0].id, entity_id: null })).isError, true);
  assert.equal((await box.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: 'plan-99', entity_id: null })).isError, true);
  const made = await box.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: 'ent-sub' });
  assert.equal(made.isError, false);
  assert.equal(created.length, 1);
  assert.equal(created[0].page, 2);
  assert.equal(created[0].entityId, 'ent-sub');
  assert.equal(created[0].moduleId, 'mod-1');
  assert.ok(boundsCover(created[0].bounds, { x: 300, y: 100, width: 24, height: 8 }));
  assert.match(made.content, /id new-1\./);
  const again = await box.run('create_item', { name: 'd119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: null });
  assert.equal(again.isError, true, 'no second D-119');
  assert.deepEqual(box.undo([made.change]), { reverted: 1, kept: 0 });
  assert.deepEqual(deleted, ['new-1']);
  assert.equal(markers['new-1'], undefined);
});

test('undo of a turn that added and filled an item removes it; a later tap keeps it', async () => {
  const { bridge, markers, deleted } = planBridge();
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const { matches } = JSON.parse((await box.run('find_on_plan', { text: 'D-119' })).content);
  const made = await box.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: null });
  const filled = await box.run('set_answers', { item_id: 'new-1', answers: [{ checklist_item_id: 'chk-lock', value: 'Y' }] });
  assert.deepEqual(box.undo([made.change, filled.change]), { reverted: 2, kept: 0 });
  assert.deepEqual(deleted, ['new-1']);

  const made2 = await box.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: null });
  const id = /id (\S+)\.$/.exec(made2.content)[1];
  markers[id].checklistResponses = { 'chk-lock': { selection: 'N' } };
  assert.deepEqual(box.undo([made2.change]), { reverted: 0, kept: 1 });
  assert.ok(markers[id], 'kept, the person filled it in');
});

test('a viewer cannot add items', async () => {
  const { bridge, created } = planBridge({ canEdit: false });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const { matches } = JSON.parse((await box.run('find_on_plan', { text: 'D-119' })).content);
  assert.equal((await box.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: null })).isError, true);
  assert.equal(created.length, 0);
});

test('a later toolbox on the same document can create from a prior plan match', async () => {
  const { bridge, created } = planBridge({ documentId: 'doc-match-lifetime' });
  const first = createSurveyAgentToolbox({ getBridge: () => bridge });
  const { matches } = JSON.parse((await first.run('find_on_plan', { text: 'D-119' })).content);
  const later = createSurveyAgentToolbox({ getBridge: () => bridge });
  const made = await later.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: null });
  assert.equal(made.isError, false);
  assert.equal(created.length, 1);
});

test('a plan match from another document cannot place an item', async () => {
  const { bridge, created } = planBridge({ documentId: 'doc-match-a' });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const { matches } = JSON.parse((await box.run('find_on_plan', { text: 'D-119' })).content);
  bridge.documentId = 'doc-match-b';
  const made = await box.run('create_item', { name: 'D-119', category_id: 'cat-door', plan_match_id: matches[0].id, entity_id: null });
  assert.equal(made.isError, true);
  assert.match(made.content, /No plan match/);
  assert.equal(created.length, 0);
});
