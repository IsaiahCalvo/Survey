// Codex review (release PR, P1): undo / redo snapshots share unchanged pages
// by object identity (utils/historySnapshotShare.js). renumberCounters used to
// rewrite counter numbers ON the live page objects, so a page whose numbers
// changed kept its identity and the next snapshot reused the stale copy:
// the live page-2 counter said 3 while the snapshot still said 2, and undo /
// redo could put the stale number back. renumberCounters is now copy-on-write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renumberCounters } from '../src/utils/counterNumbering.js';
import { snapshotAnnotationPages } from '../src/utils/historySnapshotShare.js';
import { guardLockedMarksOnSave, withMarkLock } from '../src/utils/markLock.js';
import { readFileSync } from 'node:fs';

const clone = (value) => structuredClone(value);

function counter(id, createdAt, displayNumber) {
  return {
    type: 'circle',
    id,
    data: { type: 'counter', seriesId: 's1', seriesStart: 1, createdAt, displayNumber },
  };
}

function numbers(byPage) {
  const out = {};
  for (const key of Object.keys(byPage)) {
    out[key] = (byPage[key]?.objects || []).map((o) => o.data?.displayNumber);
  }
  return out;
}

test('inserting an earlier counter on page 1 renumbers page 2 in the next snapshot', () => {
  const page1 = { objects: [counter('a', 100, 1)] };
  const page2 = { objects: [counter('b', 300, 2)] };
  const live = { 1: page1, 2: page2 };
  const first = snapshotAnnotationPages(live, clone);
  assert.deepEqual(numbers(first), { 1: [1], 2: [2] });

  // A counter created between the two (e.g. redo of a deleted pin) lands on
  // page 1: the viewer shallow-copies the map, replaces page 1, renumbers.
  const next = { ...live, 1: { ...page1, objects: [...page1.objects, counter('c', 200, 99)] } };
  renumberCounters(next);
  assert.deepEqual(numbers(next), { 1: [1, 2], 2: [3] });

  const second = snapshotAnnotationPages(next, clone);
  assert.deepEqual(numbers(second), { 1: [1, 2], 2: [3] }, 'the snapshot records the live numbers');
  assert.deepEqual(numbers(first), { 1: [1], 2: [2] }, 'the earlier snapshot is untouched');
});

test('deleting a counter on page 1 renumbers page 2 without editing the old page objects', () => {
  const page1 = { objects: [counter('a', 100, 1)] };
  const page2 = { objects: [counter('b', 300, 2)] };
  const live = { 1: page1, 2: page2 };
  const first = snapshotAnnotationPages(live, clone);

  const next = { ...live, 1: { ...page1, objects: [] } };
  const result = renumberCounters(next);
  assert.equal(result, next, 'still returns the map it was given');
  assert.deepEqual(numbers(next), { 1: [], 2: [1] });
  assert.notEqual(next[2], page2, 'a renumbered page is a new object');
  assert.equal(page2.objects[0].data.displayNumber, 2, 'the old live page object is never edited');

  const second = snapshotAnnotationPages(next, clone);
  assert.deepEqual(numbers(second), { 1: [], 2: [1] });
  assert.deepEqual(numbers(first), { 1: [1], 2: [2] });
});

test('a restored snapshot page made live again is not edited by renumbering', () => {
  const live = { 1: { objects: [counter('a', 100, 1)] }, 2: { objects: [counter('b', 300, 2)] } };
  const snap = snapshotAnnotationPages(live, clone);
  // Undo restores the snapshot map: its page objects become live state.
  const restored = { ...snap, 1: { objects: [] } };
  renumberCounters(restored);
  assert.equal(restored[2].objects[0].data.displayNumber, 1);
  assert.equal(snap[2].objects[0].data.displayNumber, 2, 'the snapshot copy keeps its numbers');
});

test('pages whose numbers do not change keep their identity', () => {
  const page1 = { objects: [counter('a', 100, 1), { type: 'rect', id: 'r' }] };
  const page2 = { objects: [counter('b', 300, 2)] };
  const page3 = { objects: [{ type: 'path', id: 'p' }] };
  const byPage = { 1: page1, 2: page2, 3: page3 };
  renumberCounters(byPage);
  assert.equal(byPage[1], page1);
  assert.equal(byPage[2], page2);
  assert.equal(byPage[3], page3);
});

test('only the counters that change are new objects; other marks are shared', () => {
  const rect = { type: 'rect', id: 'r' };
  const keep = counter('a', 100, 1);
  const stale = counter('b', 300, 7);
  const page = { objects: [keep, rect, stale], meta: 'x' };
  const byPage = { 1: page };
  renumberCounters(byPage);
  assert.notEqual(byPage[1], page);
  assert.equal(byPage[1].meta, 'x');
  assert.equal(byPage[1].objects[0], keep);
  assert.equal(byPage[1].objects[1], rect);
  assert.notEqual(byPage[1].objects[2], stale);
  assert.equal(byPage[1].objects[2].data.displayNumber, 2);
  assert.equal(stale.data.displayNumber, 7);
});

test('Undo/Redo: the lock guard runs before renumbering, so a locked counter is renumbered, not blocked', () => {
  // Alice locked her page-2 pin; Bob undoes the delete of an earlier pin on page 1.
  const page1 = { objects: [] };
  const page2 = { objects: [withMarkLock(counter('b', 300, 1), 'alice')] };
  const live = { 1: page1, 2: page2 };
  const next = { ...live, 1: { objects: [counter('a', 100, 1)] } };

  // Guard first (PDFViewer applyLocalAnnotationHistoryAction order).
  for (const key of Object.keys(next)) {
    if (next[key] === live[key]) continue;
    const guard = guardLockedMarksOnSave({
      previousObjects: live[key]?.objects || [],
      nextObjects: next[key].objects,
      viewerId: 'bob',
      documentOwnerId: 'owner',
    });
    assert.equal(guard.changed, false);
  }
  renumberCounters(next);
  assert.deepEqual(numbers(next), { 1: [1], 2: [2] });

  // The old order would have reported Alice's pin as a blocked edit.
  const late = guardLockedMarksOnSave({
    previousObjects: page2.objects,
    nextObjects: next[2].objects,
    viewerId: 'bob',
    documentOwnerId: 'owner',
  });
  assert.equal(late.changed, true, 'why the guard must run first');

  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const start = viewer.indexOf('const applyLocalAnnotationHistoryAction = useCallback(');
  const body = viewer.slice(start, viewer.indexOf('revealUndoneHistoryPage(scopedAction);', start));
  assert.ok(body.indexOf('guardLockedMarksOnSave(') > 0);
  assert.ok(body.indexOf('guardLockedMarksOnSave(') < body.indexOf('renumberCounters(nextAnnotationsByPage)'));
});
