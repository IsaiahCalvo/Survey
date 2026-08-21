import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isLegacyAnnotationHistoryMeta } from '../src/utils/historyHelpers.js';
import {
  applyBookmarkHistorySlice,
  countBookmarkDescendants,
  deleteBookmarksById,
  describeBookmarkDeleteConfirm,
  historyStateHasBookmarks,
  nextBookmarkOrder,
  planBookmarkDelete,
  prepareAtomicBookmarkEdit,
  snapshotBookmarksForHistory,
} from '../src/sidebar/bookmarkEditUtils.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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

test('P1-45: group delete confirm counts nested items', () => {
  const tree = [
    { id: 'g1', name: 'Zone A', type: 'folder', parentId: null },
    { id: 'b1', name: 'Door', type: 'bookmark', parentId: 'g1' },
    { id: 'g2', name: 'Nested', type: 'folder', parentId: 'g1' },
    { id: 'b2', name: 'Roof', type: 'bookmark', parentId: 'g2' },
    { id: 'lone', name: 'Site', type: 'bookmark', parentId: null },
  ];
  assert.equal(countBookmarkDescendants(tree, 'g1'), 3);
  assert.equal(describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'g1' }),
    'Delete group "Zone A" and 3 nested items?');
  assert.equal(describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'g2' }),
    'Delete group "Nested" and 1 nested item?');
  assert.equal(
    describeBookmarkDeleteConfirm({ bookmarks: [{ id: 'empty', name: 'Empty', type: 'folder' }], id: 'empty' }),
    'Delete group "Empty"?',
  );
  assert.equal(describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'lone' }),
    'Delete bookmark "Site"?');
  assert.equal(describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'missing' }), null);
  assert.doesNotMatch(
    describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'g1' }),
    /cannot be undone/i,
  );
  assert.deepEqual(deleteBookmarksById(tree, 'g1').map((item) => item.id), ['lone']);
});

test('P1-45: intended delete snapshot restores the nested subtree', () => {
  const tree = [
    { id: 'g1', name: 'Zone A', type: 'folder', parentId: null },
    { id: 'b1', name: 'Door', type: 'bookmark', parentId: 'g1' },
    { id: 'g2', name: 'Nested', type: 'folder', parentId: 'g1' },
    { id: 'b2', name: 'Roof', type: 'bookmark', parentId: 'g2' },
    { id: 'lone', name: 'Site', type: 'bookmark', parentId: null },
  ];
  const plan = planBookmarkDelete(tree, 'g1');
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.next.map((item) => item.id), ['lone']);
  assert.deepEqual(plan.removed.map((item) => item.id), ['g1', 'b1', 'g2', 'b2']);
  const checkpoint = applyBookmarkHistorySlice({ annotationsByPage: {}, spaces: [] }, plan.previous);
  assert.equal(historyStateHasBookmarks(checkpoint), true);
  assert.deepEqual(checkpoint.bookmarks.map((item) => item.id), tree.map((item) => item.id));
  assert.deepEqual(snapshotBookmarksForHistory(checkpoint.bookmarks).map((item) => item.id), tree.map((item) => item.id));
});

test('P1-45: break — missing or unknown id does not checkpoint a delete', () => {
  const tree = [{ id: 'lone', name: 'Site', type: 'bookmark', parentId: null }];
  assert.equal(planBookmarkDelete(tree, 'missing').ok, false);
  assert.equal(planBookmarkDelete(tree, '').ok, false);
  assert.equal(planBookmarkDelete(tree, null).ok, false);
  assert.deepEqual(planBookmarkDelete(tree, 'missing').next, tree);
  assert.equal(describeBookmarkDeleteConfirm({ bookmarks: tree, id: 'missing' }), null);
});

test('P1-45: edge — annotation snapshots without a bookmarks key do not restore sidebar', () => {
  const annotationOnly = { annotationsByPage: { 1: { objects: [] } }, spaces: [] };
  assert.equal(historyStateHasBookmarks(annotationOnly), false);
  const emptyDelete = applyBookmarkHistorySlice(annotationOnly, []);
  assert.equal(historyStateHasBookmarks(emptyDelete), true);
  assert.deepEqual(emptyDelete.bookmarks, []);
  const original = [{ id: 'a', name: 'A' }];
  const cloned = snapshotBookmarksForHistory(original);
  cloned[0].name = 'mutated';
  assert.equal(original[0].name, 'A');
  assert.equal(isLegacyAnnotationHistoryMeta({ reason: 'bookmark:delete' }), true);
  assert.equal(isLegacyAnnotationHistoryMeta({ reason: 'annotations:save' }), true);
  assert.equal(isLegacyAnnotationHistoryMeta({ reason: 'unspecified' }), false);
});

test('P1-45: BookmarksPanel confirms through the nested-count helper', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /describeBookmarkDeleteConfirm\(\{ bookmarks, id \}\)/);
  assert.match(panel, /window\.confirm\(message\)/);
  assert.doesNotMatch(panel, /Delete \$\{isFolder \? 'group' : 'bookmark'\}/);
});

test('P1-48: desktop commitName uses the atomic helper (intended + break + edge)', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  const commitName = panel.match(/const commitName = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(commitName, 'desktop commitName is present');
  assert.match(commitName[0], /prepareAtomicBookmarkEdit\(\{/);
  assert.match(commitName[0], /showToast\(result\.error, 'warn'\)/);
  assert.match(commitName[0], /setEditName\(item\.name \|\| ''\)/);
  assert.match(commitName[0], /onRename\?\.\(item\.id, result\.updates\.name\)/);
  assert.doesNotMatch(commitName[0], /onRename\?\.\(item\.id, nextName\)/);

  const conflict = prepareAtomicBookmarkEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Roof',
    page: '1',
    numPages: 4,
  });
  const empty = prepareAtomicBookmarkEdit({
    bookmarks: original,
    bookmark: original[0],
    name: '   ',
    page: '1',
    numPages: 4,
  });
  const ok = prepareAtomicBookmarkEdit({
    bookmarks: original,
    bookmark: original[0],
    name: 'Lobby',
    page: '1',
    numPages: 4,
  });
  assert.equal(conflict.ok, false);
  assert.equal(empty.ok, false);
  assert.equal(ok.ok, true);
  assert.equal(ok.updates.name, 'Lobby');
});

test('P1-44 intended: new bookmarks append after the sibling max order', () => {
  const list = [
    { id: 'a', name: 'Two', parentId: null, order: 2 },
    { id: 'b', name: 'Five', parentId: null, order: 5 },
    { id: 'c', name: 'Nested', parentId: 'folder', order: 9 },
  ];
  assert.equal(nextBookmarkOrder(list, null), 6);
  assert.equal(nextBookmarkOrder(list, 'folder'), 10);
});

test('P1-44 break: empty list starts at 0; missing order counts as 0', () => {
  assert.equal(nextBookmarkOrder([], null), 0);
  assert.equal(nextBookmarkOrder([{ id: 'a', parentId: null }], null), 1);
});

test('P1-44 edge: desktop create stamps nextBookmarkOrder', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(panel, /order:\s*nextBookmarkOrder\(bookmarks,\s*null\)/);
  assert.match(panel, /nextBookmarkOrder\(bookmarks,\s*folderId\)/);
});
