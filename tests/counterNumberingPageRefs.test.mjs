import test from 'node:test';
import assert from 'node:assert/strict';

import { renumberCounters } from '../src/utils/counterNumbering.js';

const page = (objects) => ({ version: '5.3.0', objects });
const counter = (id, createdAt, displayNumber, extra = {}) => ({
  type: 'group',
  left: 10,
  top: 20,
  ...extra,
  data: {
    id,
    type: 'counter',
    seriesId: extra.seriesId || 'series-a',
    seriesStart: extra.seriesStart ?? 1,
    createdAt,
    displayNumber,
  },
});

test('cross-page renumber replaces changed page buckets so sync can persist them', () => {
  const page1 = page([
    counter('c1', 1, 1),
    { type: 'path', data: { id: 'ink' } },
  ]);
  const page2 = page([
    counter('c2', 2, 2),
    counter('c3', 3, 3),
  ]);
  const page3 = page([
    { type: 'rect', data: { id: 'box' } },
  ]);
  const byPage = { 1: page1, 2: page2, 3: page3 };

  // Simulate deleting pin #1 (c1) then renumbering the rest of the series.
  byPage[1] = { ...page1, objects: [page1.objects[1]] };
  const result = renumberCounters(byPage);

  assert.equal(result, byPage, 'same map reference is returned');
  assert.notEqual(result[2], page2, 'page 2 bucket must be replaced');
  assert.equal(result[3], page3, 'pages without counters stay the same ref');
  assert.notEqual(result[2].objects[0], page2.objects[0], 'changed counters are cloned');
  assert.deepEqual(
    result[2].objects.map((obj) => obj.data.displayNumber),
    [1, 2],
  );
  assert.equal(result[2].objects[0].data.seriesStart, 1);
  assert.equal(page2.objects[0].data.displayNumber, 2, 'original page 2 objects are not mutated');
});

test('already-correct numbering does not replace page buckets', () => {
  const page1 = page([counter('c1', 1, 1), counter('c2', 2, 2)]);
  const byPage = { 1: page1 };
  const result = renumberCounters(byPage);
  assert.equal(result[1], page1);
});

test('hostile / empty inputs do not throw', () => {
  assert.equal(renumberCounters(null), null);
  assert.deepEqual(renumberCounters({}), {});
  assert.deepEqual(renumberCounters({ 1: { objects: null } }), { 1: { objects: null } });
  const sparse = { 1: { objects: [null, counter('c1', 1, 9)] } };
  const result = renumberCounters(sparse);
  assert.equal(result[1].objects[1].data.displayNumber, 1);
});
