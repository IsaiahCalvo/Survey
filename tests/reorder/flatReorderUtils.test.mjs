import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActiveOverIndices,
  moveItem,
  moveItemById,
  moveScopedItem,
  moveVisibleItemById,
  restrictToHorizontalAxis,
  restrictToVerticalAxis,
} from '../../src/reorder/flatReorderUtils.js';
import { readFileSync } from 'node:fs';

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

test('axis locks keep only the allowed direction and leave the scale alone', () => {
  const transform = { x: 12, y: -7, scaleX: 1, scaleY: 1 };
  assert.deepEqual(restrictToHorizontalAxis({ transform }), { x: 12, y: 0, scaleX: 1, scaleY: 1 });
  assert.deepEqual(restrictToVerticalAxis({ transform }), { x: 0, y: -7, scaleX: 1, scaleY: 1 });
  assert.deepEqual(transform, { x: 12, y: -7, scaleX: 1, scaleY: 1 }, 'input is not mutated');
});

// KAL-84: one copy of each reorder helper. The tab strip, the template module
// tabs, the shared list and the page strip import them instead of keeping
// their own.
test('reorder surfaces use the shared helpers, not local copies', () => {
  const read = (rel) => readFileSync(new URL(`../../src/${rel}`, import.meta.url), 'utf8');
  const surfaces = {
    'TabBar.jsx': ['moveItem', 'restrictToHorizontalAxis'],
    'home/TemplatesEditor.jsx': ['restrictToHorizontalAxis'],
    'reorder/SortableRearrangeList.jsx': ['restrictToVerticalAxis'],
    'sidebar/PagesPanel.jsx': ['restrictToVerticalAxis'],
  };
  for (const [rel, names] of Object.entries(surfaces)) {
    const source = read(rel);
    for (const name of names) {
      assert.match(source, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '[./]*reorder/flatReorderUtils\\.js'|import \\{[^}]*\\b${name}\\b[^}]*\\} from '\\./flatReorderUtils\\.js'`), `${rel} imports ${name}`);
    }
    assert.doesNotMatch(source, /const (restrict\w*Axis|moveArrayItem) = /, `${rel} keeps no local copy`);
  }
});
