import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countNestedBookmarks,
  formatBookmarkDeleteConfirm,
  nextBookmarkOrder,
  prepareAtomicBookmarkEdit,
  prepareBookmarkNameEdit,
} from '../src/sidebar/bookmarkEditUtils.js';

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

test('new bookmarks stamp max+1 order so they do not jump to the top', () => {
  const ordered = [
    { id: 'a', name: 'Cover', type: 'bookmark', order: 2, parentId: null },
    { id: 'b', name: 'Riser', type: 'bookmark', order: 5, parentId: null },
    { id: 'c', name: 'Nested', type: 'bookmark', order: 0, parentId: 'folder' },
  ];
  assert.equal(nextBookmarkOrder(ordered, null), 6);
  assert.equal(nextBookmarkOrder(ordered, 'folder'), 1);
  assert.equal(nextBookmarkOrder([], null), 0);
  assert.equal(nextBookmarkOrder([{ id: 'x', parentId: null }], null), 1);
});

test('rejected duplicate rename reports revertName and does not treat the typed name as saved', () => {
  const result = prepareBookmarkNameEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Roof',
  });
  assert.equal(result.ok, false);
  assert.equal(result.revertName, 'Entrance');
  assert.match(result.error, /already exists/i);

  const blank = prepareBookmarkNameEdit({
    bookmarks: original,
    bookmark: original[0],
    name: '   ',
  });
  assert.equal(blank.ok, false);
  assert.equal(blank.revertName, 'Entrance');

  const ok = prepareBookmarkNameEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Main entrance',
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.updates, { name: 'Main entrance' });
});

test('deleting a group confirm names the nested bookmark count', () => {
  const tree = [
    { id: 'g', name: 'Details', type: 'folder', parentId: null },
    { id: 'a', name: 'Panel', type: 'bookmark', parentId: 'g' },
    { id: 'b', name: 'Legend', type: 'bookmark', parentId: 'g' },
    { id: 'c', name: 'Nested folder', type: 'folder', parentId: 'g' },
    { id: 'd', name: 'Deep', type: 'bookmark', parentId: 'c' },
  ];
  assert.equal(countNestedBookmarks(tree, 'g'), 4);
  assert.equal(countNestedBookmarks(tree, 'a'), 0);
  assert.match(
    formatBookmarkDeleteConfirm({ id: 'g', name: 'Details', type: 'folder' }, 4),
    /permanently delete 4 nested bookmarks/,
  );
  assert.equal(
    formatBookmarkDeleteConfirm({ id: 'a', name: 'Panel', type: 'bookmark' }, 0),
    'Delete bookmark "Panel"?',
  );
});

test('BookmarksPanel create and delete paths use the new helpers', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/sidebar/BookmarksPanel.jsx'),
    'utf8',
  );
  assert.match(src, /nextBookmarkOrder\(bookmarks/);
  assert.match(src, /formatBookmarkDeleteConfirm/);
  assert.match(src, /prepareBookmarkNameEdit/);
  assert.match(src, /collectBookmarkTreePersistUpdates/);
  assert.match(src, /accepted === false/);
});
