/* BL-17 S1 / KAL-298 — id-keyed bulk-selection invariants.

   Pins the contract that makes index-keyed selection bugs structurally
   impossible: ids resolve against the CURRENT list at action time, stale ids
   are silent no-ops, and duplicates (if ids ever collide) hit every match. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickByIds, removeByIds, duplicateAfterByIds } from '../src/home/selectionById.js';

const item = (id) => ({ id, name: `item-${id}` });
const ids = (list) => list.map((x) => x.id);

test('reorder survival: selected ids hit exactly the originally-selected items after a reorder', () => {
  const a = item('a'); const b = item('b'); const c = item('c'); const d = item('d');
  const selected = new Set(['a', 'c']);
  // List reorders between selecting and acting.
  const reordered = [d, c, b, a];

  assert.deepEqual(ids(pickByIds(reordered, selected)), ['c', 'a']); // order-preserving over the NEW order
  assert.deepEqual(ids(removeByIds(reordered, selected)), ['d', 'b']);

  const dup = duplicateAfterByIds(reordered, selected, (x) => ({ ...x, id: `${x.id}-copy` }));
  assert.deepEqual(ids(dup), ['d', 'c', 'c-copy', 'b', 'a', 'a-copy']);
});

test('stale-id no-op: an id no longer present affects nothing — never a different item', () => {
  const list = [item('x'), item('y')];
  const stale = new Set(['gone', 'also-gone']);

  assert.deepEqual(pickByIds(list, stale), []);
  assert.deepEqual(removeByIds(list, stale), list);
  let cloneCalls = 0;
  const dup = duplicateAfterByIds(list, stale, (x) => { cloneCalls += 1; return { ...x }; });
  assert.deepEqual(ids(dup), ['x', 'y']);
  assert.equal(cloneCalls, 0);

  // Mixed: one live id + one stale id → only the live one is affected.
  const mixed = new Set(['y', 'gone']);
  assert.deepEqual(ids(pickByIds(list, mixed)), ['y']);
  assert.deepEqual(ids(removeByIds(list, mixed)), ['x']);
});

test('duplicate placement + identity: copies land directly after their source, clone called once per match in list order', () => {
  const list = [item('a'), item('b'), item('c')];
  const calls = [];
  const dup = duplicateAfterByIds(list, new Set(['a', 'c']), (x) => {
    calls.push(x.id);
    return { ...x, id: `${x.id}2` };
  });
  assert.deepEqual(ids(dup), ['a', 'a2', 'b', 'c', 'c2']);
  assert.deepEqual(calls, ['a', 'c']);
  // Originals are the same references — only copies are new objects.
  assert.equal(dup[0], list[0]);
  assert.equal(dup[2], list[1]);
});

test('empty/edge: empty id set is identity; all-ids is full effect', () => {
  const list = [item('a'), item('b')];

  assert.deepEqual(pickByIds(list, new Set()), []);
  assert.deepEqual(removeByIds(list, new Set()), list);
  assert.deepEqual(ids(duplicateAfterByIds(list, new Set(), (x) => x)), ['a', 'b']);

  const all = new Set(['a', 'b']);
  assert.deepEqual(ids(pickByIds(list, all)), ['a', 'b']);
  assert.deepEqual(removeByIds(list, all), []);
  assert.deepEqual(ids(duplicateAfterByIds(list, all, (x) => ({ id: `${x.id}*` }))), ['a', 'a*', 'b', 'b*']);

  // Empty list is safe for every helper.
  assert.deepEqual(pickByIds([], all), []);
  assert.deepEqual(removeByIds([], all), []);
  assert.deepEqual(duplicateAfterByIds([], all, (x) => x), []);
});

test('duplicate-id corner: if ids ever collide, EVERY matching item is affected (filter semantics)', () => {
  const twin1 = { id: 'twin', tag: 1 };
  const twin2 = { id: 'twin', tag: 2 };
  const list = [twin1, item('solo'), twin2];
  const sel = new Set(['twin']);

  assert.deepEqual(pickByIds(list, sel).map((x) => x.tag), [1, 2]);
  assert.deepEqual(ids(removeByIds(list, sel)), ['solo']);
  const dup = duplicateAfterByIds(list, sel, (x) => ({ ...x, copy: true }));
  assert.equal(dup.length, 5);
  assert.deepEqual(dup.map((x) => x.copy === true), [false, true, false, false, true]);
  // Each copy sits directly after ITS OWN source (tag pins which twin).
  assert.deepEqual(dup.map((x) => x.tag), [1, 1, undefined, 2, 2]);
});

test('ids accepted as Set or array', () => {
  const list = [item('a'), item('b'), item('c')];
  assert.deepEqual(ids(pickByIds(list, ['b', 'a'])), ['a', 'b']);
  assert.deepEqual(ids(removeByIds(list, ['c'])), ['a', 'b']);
});
