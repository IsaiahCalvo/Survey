import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActiveOverIndices,
  moveItem,
  moveItemById,
  moveScopedItem,
  moveVisibleItemById,
} from '../../src/reorder/flatReorderUtils.js';

const item = (id, scope = 'a') => ({ id, scope });

test('moveItem reorders by index', () => {
  const items = ['a', 'b', 'c'];
  assert.deepEqual(moveItem(items, 0, 2), ['b', 'c', 'a']);
});

test('moveItem returns original array for invalid moves', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(moveItem(items, -1, 2), items);
  assert.equal(moveItem(items, 0, 9), items);
  assert.equal(moveItem(items, 1, 1), items);
});

test('getActiveOverIndices finds item ids', () => {
  const items = [item('a'), item('b'), item('c')];
  assert.deepEqual(getActiveOverIndices(items, 'b', 'c'), { fromIndex: 1, toIndex: 2 });
});

test('moveItemById reorders objects by id', () => {
  const items = [item('a'), item('b'), item('c')];
  assert.deepEqual(moveItemById(items, 'c', 'a').map(({ id }) => id), ['c', 'a', 'b']);
});

test('moveVisibleItemById only reorders visible ids in the source list', () => {
  const items = [item('a'), item('hidden'), item('b'), item('c')];
  const next = moveVisibleItemById(items, ['a', 'b', 'c'], 'c', 'a');
  assert.deepEqual(next.map(({ id }) => id), ['c', 'hidden', 'a', 'b']);
});

test('moveScopedItem only reorders matching scope', () => {
  const items = [item('a1', 'a'), item('b1', 'b'), item('a2', 'a'), item('b2', 'b')];
  const next = moveScopedItem(items, (candidate) => candidate.scope === 'b', 'b2', 'b1');
  assert.deepEqual(next.map(({ id }) => id), ['a1', 'b2', 'a2', 'b1']);
});
