import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOOKMARK_INDENTATION_WIDTH,
  BOOKMARK_NEST_DWELL_MS,
  applyBookmarkTreeProjection,
  buildBookmarkTree,
  createBookmarkDragIntent,
  flattenBookmarkTreeForSort,
  getAutoExpandTargetFolder,
  getBookmarkProjection,
  mergeDragHandleProps,
  removeChildrenOf,
  resolveBookmarkDragIntent,
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

/*
 * UX 2026-09-30 — drag intent (owner: moving into / out of a folder was jumpy;
 * "it has to get paused a little bit when moving into folders and out of
 * folders"). A small drag simulator: rows are 40px tall, laid out from y=0 in
 * visible order; each step feeds the dragged row's centre / sideways offset /
 * clock to resolveBookmarkDragIntent, exactly as the panel's collision
 * detection does.
 */
const ROW = 40;
const makeDrag = (tree, activeId) => {
  const visible = removeChildrenOf(
    flattenBookmarkTreeForSort(tree),
    flattenBookmarkTreeForSort(tree).filter((item) => item.collapsed).map(({ id }) => id),
  );
  const items = removeChildrenOf(visible, [activeId]);
  const rects = new Map(items.map((item, index) => [item.id, { top: index * ROW, height: ROW }]));
  let intent = createBookmarkDragIntent(items, activeId);
  const log = [];
  const at = (centerY, now, dx = 0) => {
    const result = resolveBookmarkDragIntent(intent, { items, activeId, rects, centerY, dx, now });
    intent = result.intent;
    log.push(`${intent.overId}|${intent.depth}|${intent.parentId ?? 'root'}`);
    return { ...intent, wakeAt: result.wakeAt };
  };
  const centerOf = (id) => rects.get(id).top + ROW / 2;
  const changes = () => log.filter((entry, index) => index > 0 && entry !== log[index - 1]).length;
  return { at, centerOf, changes, get intent() { return intent; } };
};

const openTree = () => [
  bookmark('a'),
  folder('f', 'Folder', [bookmark('f1'), bookmark('f2')]),
  bookmark('c'),
];
const closedTree = () => [
  bookmark('a'),
  folder('k', 'Closed', [bookmark('k1')], true),
  bookmark('d'),
];

test('drag intent: a finger resting on the line under a folder never flips in and out', () => {
  const drag = makeDrag(openTree(), 'c');
  const boundary = drag.centerOf('c') - ROW / 2; // the line between f2 and c
  for (let now = 0; now <= 2000; now += 16) {
    // ±7px tremor straddling the line, plus sideways drift under the step
    drag.at(boundary + 7 * Math.sin(now / 60), now, 12 * Math.sin(now / 90));
  }
  assert.equal(drag.changes(), 0);
  assert.equal(drag.intent.parentId, null);
  assert.equal(drag.intent.overId, 'c');
});

test('drag intent: resting on a closed folder enters it only after the dwell', () => {
  const drag = makeDrag(closedTree(), 'a');
  const middle = drag.centerOf('k');
  const first = drag.at(middle, 0);
  assert.equal(first.parentId, null, 'no instant nest');
  assert.equal(first.pending?.intoId, 'k', 'the folder shows as about-to-enter');
  assert.equal(first.wakeAt, BOOKMARK_NEST_DWELL_MS);
  assert.equal(drag.at(middle + 2, BOOKMARK_NEST_DWELL_MS - 50).parentId, null);
  const entered = drag.at(middle + 1, BOOKMARK_NEST_DWELL_MS + 5);
  assert.equal(entered.parentId, 'k');
  assert.equal(entered.depth, 1);
  assert.equal(entered.intoId, 'k');
  // and it stays in while the finger rests in the slot the rows opened
  assert.equal(drag.at(middle + 3, 900).parentId, 'k');
});

test('drag intent: a drag that keeps moving passes a folder by', () => {
  const drag = makeDrag(closedTree(), 'a');
  // cross the whole closed-folder row at ~60px/s — slow, but never resting
  for (let now = 0, y = drag.centerOf('a'); y <= drag.centerOf('d') + 10; now += 16, y += 1) {
    drag.at(y, now);
  }
  assert.equal(drag.intent.parentId, null);
  assert.equal(drag.intent.overId, 'd');
});

test('drag intent: sideways nesting needs a clear move, with hysteresis back', () => {
  const drag = makeDrag(closedTree(), 'd');
  const y = drag.centerOf('d');
  assert.equal(drag.at(y, 0, 14).parentId, null, '14px sideways is a wobble, not a nest');
  const nested = drag.at(y, 16, 19);
  assert.equal(nested.parentId, 'k', 'a clear 3/4-indent move nests at once');
  assert.equal(drag.at(y, 32, 10).parentId, 'k', 'drifting back a little keeps it nested');
  assert.equal(drag.at(y, 48, 5).parentId, null, 'a clear move back un-nests at once');
});

test('drag intent: moving out above a folder waits, but does not need a still finger', () => {
  const drag = makeDrag(openTree(), 'f1');
  let now = 0;
  const start = drag.centerOf('f1');
  const target = drag.centerOf('a');
  let firstOutsideAt = null;
  for (let y = start; y >= target; y -= 2, now += 16) {
    const state = drag.at(y, now);
    if (firstOutsideAt === null && y < drag.centerOf('f') - ROW / 4) {
      firstOutsideAt = now;
      assert.equal(state.parentId, 'f', 'leaving the folder is not instant');
    }
  }
  while (now < firstOutsideAt + BOOKMARK_NEST_DWELL_MS + 32) {
    drag.at(target - 3 + (now % 32 === 0 ? 4 : 0), now);
    now += 16;
  }
  assert.equal(drag.intent.parentId, null);
  assert.equal(drag.intent.overId, 'a');
});

test('drag intent: same-level reorders commit at once', () => {
  const drag = makeDrag(openTree(), 'f2');
  const moved = drag.at(drag.centerOf('f1') + 4, 0);
  assert.equal(moved.overId, 'f1');
  assert.equal(moved.parentId, 'f');
  assert.equal(moved.pending, null);
});
