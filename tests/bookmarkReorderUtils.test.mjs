import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKMARK_INDENTATION_WIDTH,
  applyBookmarkTreeProjection,
  buildBookmarkTree,
  flattenBookmarkTreeForSort,
  getAutoExpandTargetFolder,
  getBookmarkProjection,
  mergeDragHandleProps,
  removeChildrenOf,
} from '../src/sidebar/bookmarkReorderUtils.js';

const bookmark = (id, name = id, page = 1) => ({
  id,
  name,
  type: 'bookmark',
  pageIds: [page],
  order: 0,
});

const folder = (id, name = id, children = [], collapsed = false) => ({
  id,
  name,
  type: 'folder',
  pageIds: [],
  order: 0,
  collapsed,
  children,
});

test('bookmark reorder nests a root bookmark under the preceding folder', () => {
  const tree = [
    bookmark('cover'),
    folder('details', 'Details', [bookmark('panel')]),
    bookmark('riser'),
  ];
  const visibleItems = flattenBookmarkTreeForSort(tree);
  const projection = getBookmarkProjection(
    visibleItems,
    'riser',
    'panel',
    BOOKMARK_INDENTATION_WIDTH,
  );

  assert.equal(projection.parentId, 'details');
  assert.equal(projection.depth, 1);

  const nextTree = applyBookmarkTreeProjection(tree, 'riser', 'panel', projection);
  assert.deepEqual(
    nextTree.map((item) => item.id),
    ['cover', 'details'],
  );
  assert.deepEqual(
    nextTree[1].children.map((item) => item.id),
    ['riser', 'panel'],
  );
});

test('bookmark reorder unnests a child bookmark back to the root level', () => {
  const tree = [
    folder('details', 'Details', [bookmark('panel'), bookmark('legend')]),
    bookmark('riser'),
  ];
  const visibleItems = flattenBookmarkTreeForSort(tree);
  const projection = getBookmarkProjection(
    visibleItems,
    'panel',
    'riser',
    -BOOKMARK_INDENTATION_WIDTH,
  );

  assert.equal(projection.parentId, null);
  assert.equal(projection.depth, 0);

  const nextTree = applyBookmarkTreeProjection(tree, 'panel', 'riser', projection);
  assert.deepEqual(
    nextTree.map((item) => item.id),
    ['details', 'riser', 'panel'],
  );
  assert.deepEqual(
    nextTree[0].children.map((item) => item.id),
    ['legend'],
  );
});

test('moving a folder preserves its descendants as children', () => {
  const tree = [
    bookmark('cover'),
    folder('details', 'Details', [bookmark('panel'), bookmark('legend')]),
    bookmark('riser'),
  ];
  const visibleItems = removeChildrenOf(flattenBookmarkTreeForSort(tree), ['details']);
  const projection = getBookmarkProjection(visibleItems, 'details', 'riser', 0);

  const nextTree = applyBookmarkTreeProjection(tree, 'details', 'riser', projection);

  assert.deepEqual(
    nextTree.map((item) => item.id),
    ['cover', 'riser', 'details'],
  );
  assert.deepEqual(
    nextTree[2].children.map((item) => item.id),
    ['panel', 'legend'],
  );
});

test('collapsed folders are auto-expand targets when dragged over with rightward intent', () => {
  const tree = [
    bookmark('cover'),
    folder('details', 'Details', [bookmark('panel')], true),
    bookmark('riser'),
  ];
  const visibleItems = removeChildrenOf(flattenBookmarkTreeForSort(tree), ['details']);
  const target = getAutoExpandTargetFolder(
    visibleItems,
    'riser',
    'details',
    BOOKMARK_INDENTATION_WIDTH,
  );

  assert.equal(target.id, 'details');
});

// KAL-65 regression: the shared tooltip binding returns its own onPointerDown
// (hide-on-press). Spreading it after the @dnd-kit listeners silently replaced
// the PointerSensor's onPointerDown, so the handle never started a drag.
test('mergeDragHandleProps keeps both the tooltip press handler and the dnd-kit sensor', () => {
  const calls = [];
  const tipProps = {
    onMouseEnter: () => calls.push('tip:enter'),
    onPointerDown: () => calls.push('tip:pointerdown'),
  };
  const listeners = {
    onPointerDown: () => calls.push('dnd:pointerdown'),
    onKeyDown: () => calls.push('dnd:keydown'),
  };

  const merged = mergeDragHandleProps(tipProps, listeners);
  merged.onPointerDown({});
  merged.onKeyDown({});
  merged.onMouseEnter({});

  assert.deepEqual(calls, ['tip:pointerdown', 'dnd:pointerdown', 'dnd:keydown', 'tip:enter']);
});

test('mergeDragHandleProps tolerates a missing handler on either side', () => {
  const calls = [];
  const merged = mergeDragHandleProps({}, { onPointerDown: () => calls.push('dnd') });
  merged.onPointerDown({});
  assert.deepEqual(calls, ['dnd']);

  const noListeners = mergeDragHandleProps({ onPointerDown: () => calls.push('tip') }, {});
  noListeners.onPointerDown({});
  assert.deepEqual(calls, ['dnd', 'tip']);
});

// Drops two or more levels deep used to snap back: the panel's tree builder
// sorted only the root and its direct children, so a third level kept the
// store's array order after the optimistic tree was cleared.
test('buildBookmarkTree sorts siblings by order at every depth', () => {
  const flat = [
    // Zulu was dragged above Xray: its order changed, its array slot did not.
    { id: 'x', name: 'Xray', type: 'bookmark', parentId: 'sub', order: 1 },
    { id: 'y', name: 'Yankee', type: 'bookmark', parentId: 'sub', order: 2 },
    { id: 'z', name: 'Zulu', type: 'bookmark', parentId: 'sub', order: 0 },
    { id: 'deep-b', name: 'Deep B', type: 'bookmark', parentId: 'z', order: 1 },
    { id: 'deep-a', name: 'Deep A', type: 'bookmark', parentId: 'z', order: 0 },
    { id: 'sub', name: 'Sub', type: 'folder', parentId: 'top', order: 1 },
    { id: 'leaf', name: 'Leaf', type: 'bookmark', parentId: 'top', order: 0 },
    { id: 'top', name: 'Folder', type: 'folder', parentId: null, order: 1 },
    { id: 'alpha', name: 'Alpha', type: 'bookmark', parentId: null, order: 0 },
  ];
  const tree = buildBookmarkTree(flat);
  const ids = (nodes) => nodes.map(({ id }) => id);

  assert.deepEqual(ids(tree), ['alpha', 'top']);
  assert.deepEqual(ids(tree[1].children), ['leaf', 'sub']);
  assert.deepEqual(ids(tree[1].children[1].children), ['z', 'x', 'y']);
  assert.deepEqual(ids(tree[1].children[1].children[0].children), ['deep-a', 'deep-b']);
  // The input array is not mutated.
  assert.equal(flat[2].children, undefined);
});
