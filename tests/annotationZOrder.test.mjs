import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  annotationStableId,
  buildOriginalIndexById,
  clearZOrder,
  effectiveZOrderKey,
  generateKeyBetween,
  implicitKeyFromIndex,
  keyAfter,
  keyBefore,
  readZOrder,
  resolveAnnotationIndexById,
  sortObjectsByZOrder,
  stampZOrderAfterMove,
  stampZOrderForSelected,
  stampZOrderOnTop,
} from '../src/utils/annotationZOrder.js';
import {
  docToByPage,
  getAnnotationsMap,
  syncByPageToDoc,
} from '../src/services/annotationDocStore.js';

function shape(id, extra = {}) {
  return { type: 'rect', left: 0, top: 0, width: 10, height: 10, data: { id, ...extra } };
}

test('generateKeyBetween is strictly between bounds and never empty', () => {
  const mid = generateKeyBetween('V0001', 'V0003');
  assert.ok(mid > 'V0001' && mid < 'V0003', mid);
  const after = generateKeyBetween('V0003', null);
  assert.ok(after > 'V0003', after);
  const before = generateKeyBetween(null, 'V0001');
  assert.ok(before < 'V0001' && before.length > 0, before);
  const first = generateKeyBetween(null, null);
  assert.ok(first);
});

test('repeated insert-between does not exhaust the keyspace', () => {
  let low = implicitKeyFromIndex(0);
  const high = implicitKeyFromIndex(1);
  const keys = new Set();
  for (let i = 0; i < 80; i += 1) {
    const next = generateKeyBetween(low, high);
    assert.ok(next > low && next < high, `${next} not in (${low}, ${high})`);
    assert.equal(keys.has(next), false, `duplicate key ${next}`);
    keys.add(next);
    low = next;
  }
});

test('keyAfter / keyBefore stay ordered', () => {
  const a = implicitKeyFromIndex(2);
  assert.ok(keyAfter(a) > a);
  assert.ok(keyBefore(a) < a);
});

test('unstamped objects keep insertion order', () => {
  const objects = [shape('a'), shape('b'), shape('c')];
  const sorted = sortObjectsByZOrder(objects);
  assert.deepEqual(sorted.map(annotationStableId), ['a', 'b', 'c']);
});

test('bring-to-front stamp survives rematerialize (Y.Map insertion order)', () => {
  const objects = [shape('a'), shape('b'), shape('c')];
  const original = buildOriginalIndexById(objects);
  const next = [objects[1], objects[2], objects[0]];
  stampZOrderAfterMove(next, 2, original);

  assert.ok(readZOrder(next[2]));
  assert.equal(readZOrder(next[0]), null);
  assert.equal(readZOrder(next[1]), null);

  const resorted = sortObjectsByZOrder([objects[0], objects[1], objects[2]]);
  assert.deepEqual(resorted.map(annotationStableId), ['b', 'c', 'a']);
});

test('send-to-back stamp sorts below unstamped neighbors after rematerialize', () => {
  const objects = [shape('a'), shape('b'), shape('c')];
  const original = buildOriginalIndexById(objects);
  const next = [objects[2], objects[0], objects[1]];
  stampZOrderAfterMove(next, 0, original);

  const resorted = sortObjectsByZOrder([objects[0], objects[1], objects[2]]);
  assert.deepEqual(resorted.map(annotationStableId), ['c', 'a', 'b']);
});

test('forward one step lands between the new neighbors', () => {
  const objects = [shape('a'), shape('b'), shape('c')];
  const original = buildOriginalIndexById(objects);
  const next = [objects[0], objects[2], objects[1]];
  stampZOrderAfterMove(next, 2, original);

  const resorted = sortObjectsByZOrder([objects[0], objects[1], objects[2]]);
  assert.deepEqual(resorted.map(annotationStableId), ['a', 'c', 'b']);
});

test('identical zOrder keys tie-break by id', () => {
  const a = shape('a', { zOrder: 'M' });
  const b = shape('b', { zOrder: 'M' });
  const sorted = sortObjectsByZOrder([b, a]);
  assert.deepEqual(sorted.map(annotationStableId), ['a', 'b']);
});

test('resolveAnnotationIndexById prefers id over a stale fallback index', () => {
  const objects = [shape('a'), shape('b'), shape('c')];
  assert.equal(resolveAnnotationIndexById(objects, 'c', 0), 2);
  assert.equal(resolveAnnotationIndexById(objects, 'gone', 1), -1);
  assert.equal(resolveAnnotationIndexById(objects, null, 1), 1);
  assert.equal(resolveAnnotationIndexById(objects, null, 9), -1);
});

test('stampZOrderOnTop lands after the current last sibling', () => {
  const page = [shape('a'), shape('b')];
  const clone = shape('paste');
  stampZOrderOnTop(clone, page);
  const sorted = sortObjectsByZOrder([...page, clone]);
  assert.equal(annotationStableId(sorted[sorted.length - 1]), 'paste');
});

test('clearZOrder strips inherited source depth', () => {
  const obj = shape('x', { zOrder: 'ZZZ' });
  clearZOrder(obj);
  assert.equal(readZOrder(obj), null);
});

test('group stamp keeps selected block on top', () => {
  const objects = [shape('a'), shape('b'), shape('c'), shape('d')];
  const original = buildOriginalIndexById(objects);
  const next = [objects[0], objects[2], objects[1], objects[3]];
  stampZOrderForSelected(next, new Set(['b', 'd']), original);
  const resorted = sortObjectsByZOrder([objects[0], objects[1], objects[2], objects[3]]);
  const ids = resorted.map(annotationStableId);
  assert.ok(ids.indexOf('b') > ids.indexOf('a'));
  assert.ok(ids.indexOf('d') > ids.indexOf('c'));
});

test('syncByPageToDoc persists a reorder-only zOrder and docToByPage restores it', () => {
  const doc = new Y.Doc();
  const initial = {
    1: { objects: [shape('a'), shape('b'), shape('c')] },
  };
  syncByPageToDoc(doc, initial);

  const page = {
    objects: [shape('b'), shape('c'), { ...shape('a'), data: { id: 'a', zOrder: generateKeyBetween(effectiveZOrderKey(shape('c'), 2), null) } }],
  };
  const stats = syncByPageToDoc(doc, { 1: page }, { prevByPage: initial });
  assert.ok(stats.updated >= 1, 'zOrder stamp must emit a Yjs payload update');

  const out = docToByPage(doc);
  assert.deepEqual(out[1].objects.map(annotationStableId), ['b', 'c', 'a']);
});

test('pure permutation without zOrder still diffs to zero updates', () => {
  const doc = new Y.Doc();
  const initial = { 1: { objects: [shape('a'), shape('b')] } };
  syncByPageToDoc(doc, initial);
  const permuted = { 1: { objects: [shape('b'), shape('a')] } };
  const stats = syncByPageToDoc(doc, permuted, { prevByPage: initial });
  assert.equal(stats.updated, 0);
  assert.equal(stats.added, 0);
  assert.equal(stats.removed, 0);
});

test('imported unstamped page keeps Y.Map insertion order', () => {
  const doc = new Y.Doc();
  const map = getAnnotationsMap(doc);
  map.set('imp-0', { p: 1, o: shape('imp-0') });
  map.set('imp-1', { p: 1, o: shape('imp-1') });
  map.set('imp-2', { p: 1, o: shape('imp-2') });
  const out = docToByPage(doc);
  assert.deepEqual(out[1].objects.map(annotationStableId), ['imp-0', 'imp-1', 'imp-2']);
});
