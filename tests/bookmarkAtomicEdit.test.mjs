import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareAtomicBookmarkEdit } from '../src/sidebar/bookmarkEditUtils.js';

const original = [
  { id: 'a', name: 'Entrance', type: 'bookmark', pageIds: [1] },
  { id: 'b', name: 'Roof', type: 'bookmark', pageIds: [2] },
];

test('combined bookmark name/page edit produces one atomic update', () => {
  assert.deepEqual(prepareAtomicBookmarkEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Main entrance',
    page: '3',
    numPages: 4,
  }), {
    ok: true,
    updates: { name: 'Main entrance', pageIds: [3] },
  });
});

test('invalid page and conflicting name leave the original bookmark untouched', () => {
  const snapshot = structuredClone(original);
  const invalidPage = prepareAtomicBookmarkEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Renamed too early',
    page: '9',
    numPages: 4,
  });
  const conflict = prepareAtomicBookmarkEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Roof',
    page: '3',
    numPages: 4,
  });

  assert.equal(invalidPage.ok, false);
  assert.equal(conflict.ok, false);
  assert.deepEqual(original, snapshot);
  assert.equal(original[0].name, 'Entrance');
  assert.deepEqual(original[0].pageIds, [1]);
});
