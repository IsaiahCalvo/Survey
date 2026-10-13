// Owner 2026-10-07 (iPhone): the page menu needed a scroll to reach Delete.
// The phone's compact list keeps every action, puts the less-used ones under
// one "More" row, and stays at 10 rows or fewer (44px each fits a 375x667
// iPhone SE between the top bar and the dock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPageMenuItems } from '../src/sidebar/pageMenuItems.js';

const rowKeys = (items) => items.filter((i) => !i.separator && !i.header).map((i) => i.key);
const allKeys = (items) => rowKeys(items).flatMap((key) => {
  const item = items.find((i) => i.key === key);
  return item.more ? rowKeys(item.more) : [key];
});

const base = { pageNumber: 3, pageCount: 8, clipboardPage: null, clipboardType: null };

test('compact single-page menu keeps every action, <= 10 rows, Delete last', () => {
  const full = buildPageMenuItems({ ...base, select: true, move: { canUp: true, canDown: true } });
  const compact = buildPageMenuItems({ ...base, select: true, move: { canUp: true, canDown: true }, compact: true });
  assert.ok(rowKeys(compact).length <= 10, `rows: ${rowKeys(compact).join(',')}`);
  assert.equal(rowKeys(compact).at(-1), 'delete');
  assert.deepEqual([...allKeys(compact)].sort(), [...rowKeys(full)].sort());
  const more = compact.find((i) => i.key === 'more');
  assert.ok(more && more.backLabel === 'Page 3');
  assert.deepEqual(rowKeys(more.more), ['insertAbove', 'insertBelow', 'mirrorH', 'mirrorV', 'reset', 'moveUp', 'moveDown']);
});

test('compact menu without move / select (the viewer page menu)', () => {
  const compact = buildPageMenuItems({ ...base, compact: true });
  assert.deepEqual(rowKeys(compact), ['cut', 'copy', 'pasteAbove', 'pasteBelow', 'duplicate', 'rotateLeft', 'rotateRight', 'more', 'delete']);
});

test('a lone leftover row is not hidden behind More', () => {
  const available = { insertBlank: false, mirror: false };
  const compact = buildPageMenuItems({ ...base, compact: true, available });
  assert.ok(!rowKeys(compact).includes('more'));
  assert.ok(rowKeys(compact).includes('reset'));
});

test('desktop (not compact) list is unchanged', () => {
  const full = buildPageMenuItems({ ...base });
  assert.ok(!rowKeys(full).includes('more'));
  assert.equal(rowKeys(full).length, 13);
});
