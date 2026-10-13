// Lead decision 2026-10-13 (long lists in the survey bars): what a row shows
// is decided by COUNT, never by window width - up to 8 items all show; above
// 8, 7 show (current, then recent, then template order; drawn in template
// order) plus "All N"; find field from 15; the template menu gets the 3 most
// recently used at the top from 15 templates; recents are local only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURVEY_LIST_SEARCH_FROM,
  SURVEY_ROW_MAX_ITEMS,
  filterSurveyListItems,
  pickSurveyRowItems,
  pushSurveyRecent,
  readSurveyRecents,
  surveyTemplateSections,
} from '../src/utils/surveyPickLists.js';

const list = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i + 1}`, label: `Item ${i + 1}` }));
const ids = (items) => items.map((item) => item.id);

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

test('3 and 8 items: every one shows, no "All"', () => {
  assert.equal(SURVEY_ROW_MAX_ITEMS, 8);
  for (const n of [0, 3, 8]) {
    const row = pickSurveyRowItems(list(n), { currentId: 'c2' });
    assert.equal(row.shown.length, n);
    assert.equal(row.overflow, false);
  }
});

test('9 and 40 items: 7 show plus "All N", in template order', () => {
  for (const n of [9, 40]) {
    const row = pickSurveyRowItems(list(n));
    assert.equal(row.shown.length, 7);
    assert.equal(row.overflow, true);
    assert.equal(row.total, n);
    assert.deepEqual(ids(row.shown), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  }
});

test('the 7: the current one, then the most recent, then template order - drawn in template order', () => {
  const row = pickSurveyRowItems(list(40), { currentId: 'c30', recentIds: ['c30', 'c22', 'c9', 'nope'] });
  assert.deepEqual(ids(row.shown), ['c1', 'c2', 'c3', 'c4', 'c9', 'c22', 'c30']);
  // Picking a chip that is already showing never changes the row.
  const again = pickSurveyRowItems(list(40), { currentId: 'c2', recentIds: ['c2', 'c30', 'c22', 'c9'] });
  assert.deepEqual(ids(again.shown), ids(row.shown));
  // Ids compare as strings (a template's ids may be numbers).
  const numeric = pickSurveyRowItems(list(12).map((item, i) => ({ ...item, id: i + 1 })), { currentId: 12 });
  assert.ok(numeric.shown.some((item) => item.id === 12));
});

test('recents: most recent first, de-duplicated, capped, per template; storage failures are harmless', () => {
  const store = memoryStorage();
  pushSurveyRecent('category', 't1', 'a', store);
  pushSurveyRecent('category', 't1', 'b', store);
  pushSurveyRecent('category', 't1', 'a', store);
  assert.deepEqual(readSurveyRecents('category', 't1', store), ['a', 'b']);
  assert.deepEqual(readSurveyRecents('category', 't2', store), []);
  for (let i = 0; i < 30; i += 1) pushSurveyRecent('entity', 't1', `e${i}`, store);
  assert.equal(readSurveyRecents('entity', 't1', store).length, 12);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.deepEqual(readSurveyRecents('category', 't1', broken), []);
  assert.deepEqual(pushSurveyRecent('category', 't1', 'x', broken), ['x']);
  store.map.set('survey:recent:v1:category:t3', '{not json');
  assert.deepEqual(readSurveyRecents('category', 't3', store), []);
});

test('find: case-insensitive "contains"', () => {
  const items = [{ id: 1, label: 'Fire Alarm' }, { id: 2, label: 'Doors' }, { id: 3, label: 'Alarm panel' }];
  assert.deepEqual(filterSurveyListItems(items, 'ALARM').map((i) => i.id), [1, 3]);
  assert.equal(filterSurveyListItems(items, '  ').length, 3);
});

test('templates: plain list under 15; from 15 the 3 most recent sit on top', () => {
  assert.equal(SURVEY_LIST_SEARCH_FROM, 15);
  const few = surveyTemplateSections(list(14).map((t) => ({ id: t.id, name: t.label })), ['c3']);
  assert.equal(few.length, 1);
  const many = surveyTemplateSections(list(20).map((t) => ({ id: t.id, name: t.label })), ['c9', 'c2', 'gone', 'c17', 'c5']);
  assert.deepEqual(many.map((s) => s.label), ['Recent', 'All templates']);
  assert.deepEqual(ids(many[0].items), ['c9', 'c2', 'c17']);
  assert.equal(many[1].items.length, 20);
});
