/**
 * bookmarkReorderUtils.js — pure helpers for drag-to-reorder + nesting of the bookmark tree.
 *
 * Exports array-move, depth/projection (getBookmarkProjection), flatten/rebuild
 * (flattenBookmarkTreeForSort / buildSortableBookmarkTree), auto-expand targeting,
 * and applyBookmarkTreeProjection. Drives the bookmark sidebar's dnd-kit sortable tree.
 */
import { deepClone } from '../utils/deepClone.js';

export const BOOKMARK_INDENTATION_WIDTH = 24;
export const GROUP_AUTO_EXPAND_OFFSET_PX = 18;

export const arrayMoveBookmarkItems = (items, fromIndex, toIndex) => {
  const nextItems = items.slice();
  const startIndex = fromIndex < 0 ? nextItems.length + fromIndex : fromIndex;

  if (startIndex < 0 || startIndex >= nextItems.length) {
    return nextItems;
  }

  const [item] = nextItems.splice(startIndex, 1);
  const endIndex = toIndex < 0 ? nextItems.length + toIndex : toIndex;
  nextItems.splice(endIndex, 0, item);
  return nextItems;
};

export const getDragDepth = (offset, indentationWidth = BOOKMARK_INDENTATION_WIDTH) => (
  Math.round(offset / indentationWidth)
);

export const flattenBookmarkTreeForSort = (items, parentId = null, depth = 0) => (
  items.reduce((acc, item, index) => [
    ...acc,
    { ...item, parentId, depth, index },
    ...flattenBookmarkTreeForSort(item.children || [], item.id, depth + 1),
  ], [])
);

// Flat bookmarks array (each item carries parentId + order) -> nested tree.
// Siblings are sorted by `order` at EVERY depth: sorting only the root and its
// direct children left deeper levels in store-array order, so a drop two or
// more levels deep snapped back once the optimistic tree was cleared.
export const buildBookmarkTree = (items) => {
  if (!items || !Array.isArray(items)) {
    return [];
  }

  const itemMap = new Map();
  const rootItems = [];

  items.forEach(item => {
    if (item && item.id && item.name && item.name.trim()) {
      itemMap.set(item.id, { ...item, children: [] });
    }
  });

  items.forEach(item => {
    if (!item || !item.id) return;

    const node = itemMap.get(item.id);
    if (!node) return;

    if (item.parentId) {
      const parent = itemMap.get(item.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        rootItems.push(node);
      }
    } else {
      rootItems.push(node);
    }
  });

  const sortByOrder = (a, b) => (a.order || 0) - (b.order || 0);
  const sortLevel = (nodes) => {
    nodes.sort(sortByOrder);
    nodes.forEach(node => {
      if (node.children.length > 0) sortLevel(node.children);
    });
  };
  sortLevel(rootItems);

  return rootItems;
};

export const removeChildrenOf = (items, ids) => {
  const excludedParentIds = [...ids];
  return items.filter((item) => {
    if (item.parentId && excludedParentIds.includes(item.parentId)) {
      if (item.children?.length) {
        excludedParentIds.push(item.id);
      }
      return false;
    }
    return true;
  });
};

export const buildSortableBookmarkTree = (flattenedItems) => {
  const root = { id: 'root', children: [] };
  const nodes = new Map([['root', root]]);
  const items = flattenedItems.map(({ depth, index, parentId, ...item }) => ({
    ...item,
    parentId,
    children: [],
  }));

  items.forEach((item) => {
    nodes.set(item.id, item);
  });

  items.forEach((item) => {
    const parent = item.parentId ? nodes.get(item.parentId) : root;
    delete item.parentId;
    (parent || root).children.push(item);
  });

  return root.children;
};

// The depth range a slot allows once the dragged row is moved to `overIndex`:
// never deeper than "inside the folder above" and never shallower than the row
// below (which would orphan it).
const getSlotBounds = (items, activeIndex, overIndex) => {
  const newItems = arrayMoveBookmarkItems(items, activeIndex, overIndex);
  const previousItem = newItems[overIndex - 1];
  const nextItem = newItems[overIndex + 1];
  const canNestUnderPrevious = previousItem?.type === 'folder';
  const maxDepth = previousItem ? previousItem.depth + (canNestUnderPrevious ? 1 : 0) : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  return { newItems, previousItem, maxDepth, minDepth };
};

const getSlotParentId = (newItems, overIndex, depth) => {
  const previousItem = newItems[overIndex - 1];
  if (depth === 0 || !previousItem) return null;
  if (depth === previousItem.depth) return previousItem.parentId;
  if (depth > previousItem.depth) {
    return previousItem.type === 'folder' ? previousItem.id : previousItem.parentId;
  }

  return newItems
    .slice(0, overIndex)
    .reverse()
    .find((item) => item.depth === depth)?.parentId ?? null;
};

export const getBookmarkProjection = (
  items,
  activeId,
  overId,
  dragOffset,
  indentationWidth = BOOKMARK_INDENTATION_WIDTH,
) => {
  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);
  if (overItemIndex === -1 || activeItemIndex === -1) return null;

  const activeItem = items[activeItemIndex];
  const { newItems, maxDepth, minDepth } = getSlotBounds(items, activeItemIndex, overItemIndex);
  const dragDepth = getDragDepth(dragOffset, indentationWidth);
  const projectedDepth = activeItem.depth + dragDepth;
  const depth = Math.max(minDepth, Math.min(projectedDepth, maxDepth));

  return { depth, maxDepth, minDepth, parentId: getSlotParentId(newItems, overItemIndex, depth) };
};

/*
 * DRAG INTENT (UX 2026-09-30, owner: moving a bookmark into or out of a folder
 * was "jumpy", too eager to nest or un-nest — "it has to get paused a little
 * bit when moving into folders and out of folders. The user should feel super
 * controlled").
 *
 * The plain projection above re-derives the landing spot from scratch on every
 * frame: the row under the dragged centre picks the slot, and round(dx / 24)
 * picks the depth. A 12px sideways wobble of a thumb flipped the depth, and a
 * finger resting on the line under a folder flipped the row in and out of it
 * on every tremor. This resolver keeps a COMMITTED landing spot and only moves
 * it for a clear intent:
 *
 *   - Same-level reorders commit at once (with a few px of slot hysteresis so
 *     a finger resting on a row boundary does not see-saw the rows).
 *   - Depth is sticky: it stays what it was until the drag moves clearly
 *     sideways from where the depth last changed — half an indent (12px) to
 *     step OUT a level, BOOKMARK_DEPTH_STEP_RATIO of one (18px) to step IN —
 *     and that sideways step commits at once. Re-anchoring at each change
 *     gives the step back its own hysteresis (12px + 18px apart).
 *   - A folder row has three zones: its top quarter drops before it, its
 *     bottom quarter after it, and its middle half INTO it (Finder-style).
 *     The folder the row is already in has no "into" zone: the upper half of
 *     its header drops above it (out), the lower half keeps the row inside.
 *   - Going INTO a folder by moving up or down (its middle, or between an
 *     open folder's children) waits BOOKMARK_NEST_DWELL_MS, and needs the drag
 *     to REST there — same slot, within BOOKMARK_DWELL_STILL_RATIO of a row —
 *     for that long, so a drag that keeps moving, however slowly, passes a
 *     folder by.
 *   - Coming OUT of a folder (past its last child, above its header, or a
 *     clear move left) commits at once (UX 2026-10-01, owner: the 300ms wait
 *     to leave a folder felt sticky and laggy — "it doesn't feel as good,
 *     especially when moving a bookmark OUT of a grouped bookmark folder").
 *     Flip-flopping at the boundary is held off by the slot / depth
 *     hysteresis above, never by a timer.
 *
 * Geometry is dnd-kit's own: `rects` are the rows' layout rects (transform
 * free) and `centerY` / `dx` come from the dragged row's collision rect, all in
 * one coordinate space. Rows between the lifted row and its slot are drawn one
 * row-height displaced (verticalListSortingStrategy); the resolver hit-tests
 * against those drawn positions, so what is under the finger is what the user
 * sees under it.
 */
export const BOOKMARK_NEST_DWELL_MS = 300;
export const BOOKMARK_DEPTH_STEP_RATIO = 0.75;
export const BOOKMARK_DEPTH_STEP_OUT_RATIO = 0.5;
export const BOOKMARK_SLOT_HYSTERESIS_RATIO = 0.2;
export const BOOKMARK_FOLDER_EDGE_RATIO = 0.25;
export const BOOKMARK_DWELL_STILL_RATIO = 0.15;

export const createBookmarkDragIntent = (items, activeId) => {
  const activeItem = items.find(({ id }) => id === activeId);
  return {
    overId: activeId,
    depth: activeItem?.depth ?? 0,
    parentId: activeItem?.parentId ?? null,
    intoId: null,
    anchorX: 0,
    slotOffsetY: 0,
    pending: null,
  };
};

const sameIntent = (a, b) => (
  a.overId === b.overId &&
  a.depth === b.depth &&
  a.parentId === b.parentId &&
  a.intoId === b.intoId &&
  a.anchorX === b.anchorX &&
  a.slotOffsetY === b.slotOffsetY &&
  (a.pending?.key ?? null) === (b.pending?.key ?? null) &&
  (a.pending?.since ?? null) === (b.pending?.since ?? null) &&
  (a.pending?.intoId ?? null) === (b.pending?.intoId ?? null)
);

export const resolveBookmarkDragIntent = (intent, {
  items,
  activeId,
  rects,
  centerY,
  dx = 0,
  now = 0,
  indentationWidth = BOOKMARK_INDENTATION_WIDTH,
  dwellMs = BOOKMARK_NEST_DWELL_MS,
}) => {
  const activeIndex = items.findIndex(({ id }) => id === activeId);
  if (!intent || activeIndex === -1) return { intent, wakeAt: null };

  const getRect = (id) => (typeof rects?.get === 'function' ? rects.get(id) : rects?.[id]);
  let committedIndex = items.findIndex(({ id }) => id === intent.overId);
  if (committedIndex === -1) committedIndex = activeIndex;
  const activeRect = getRect(activeId);
  const shift = activeRect?.height ?? 0;
  const displacement = (index) => {
    if (activeIndex < index && index <= committedIndex) return -shift;
    if (committedIndex <= index && index < activeIndex) return shift;
    return 0;
  };
  const drawnPosition = (index) => {
    if (activeIndex < index && index <= committedIndex) return index - 1;
    if (committedIndex <= index && index < activeIndex) return index + 1;
    return index;
  };
  const beforeIndex = (index) => (index > activeIndex ? index - 1 : index);
  const afterIndex = (index) => (index > activeIndex ? index : index + 1);

  // The row drawn under the dragged row's centre, if any (none = the gap).
  let hovered = null;
  for (let index = 0; index < items.length && !hovered; index += 1) {
    if (index === activeIndex) continue;
    const rect = getRect(items[index].id);
    if (!rect || !(rect.height > 0)) continue;
    const top = rect.top + displacement(index);
    if (centerY >= top && centerY < top + rect.height) {
      hovered = {
        item: items[index],
        index,
        rel: (centerY - top) / rect.height,
        below: drawnPosition(index) > committedIndex,
      };
    }
  }

  let targetIndex = committedIndex;
  let intoItem = null;
  if (hovered) {
    const { item, index, rel, below } = hovered;
    if (item.type === 'folder' && item.id === intent.parentId) {
      // The row's own folder: above the header's middle is out, below is in.
      targetIndex = rel < 0.5 ? beforeIndex(index) : afterIndex(index);
    } else if (item.type === 'folder') {
      if (rel < BOOKMARK_FOLDER_EDGE_RATIO) targetIndex = beforeIndex(index);
      else if (rel > 1 - BOOKMARK_FOLDER_EDGE_RATIO) targetIndex = afterIndex(index);
      else {
        intoItem = item;
        targetIndex = afterIndex(index);
      }
    } else if (below) {
      targetIndex = rel >= BOOKMARK_SLOT_HYSTERESIS_RATIO ? afterIndex(index) : beforeIndex(index);
    } else {
      targetIndex = rel <= 1 - BOOKMARK_SLOT_HYSTERESIS_RATIO ? beforeIndex(index) : afterIndex(index);
    }
  }
  // Resting in the gap keeps whatever "into" the committed spot already had.
  const keepsInto = !hovered && targetIndex === committedIndex && intent.intoId;

  const { newItems, maxDepth, minDepth } = getSlotBounds(items, activeIndex, targetIndex);
  const clampDepth = (value) => Math.max(minDepth, Math.min(value, maxDepth));
  const stepRatio = (dx - intent.anchorX) / indentationWidth;
  const step = stepRatio >= BOOKMARK_DEPTH_STEP_RATIO ? 1 : stepRatio <= -BOOKMARK_DEPTH_STEP_OUT_RATIO ? -1 : 0;
  let depth;
  let stepped = false;
  if (intoItem) {
    depth = clampDepth(intoItem.depth + 1);
  } else {
    const resting = clampDepth(intent.depth);
    depth = clampDepth(intent.depth + step);
    stepped = step !== 0 && depth !== resting;
  }
  const parentId = getSlotParentId(newItems, targetIndex, depth);
  const candidateIntoId = intoItem?.id ?? (keepsInto && !stepped ? intent.intoId : null);

  const targetRect = getRect(items[targetIndex].id);
  const landingTop = !activeRect || !targetRect || targetIndex === activeIndex
    ? activeRect?.top ?? 0
    : targetIndex > activeIndex
      ? targetRect.top + targetRect.height - shift
      : targetRect.top;
  const candidate = {
    overId: items[targetIndex].id,
    depth,
    parentId,
    intoId: candidateIntoId,
    slotOffsetY: Math.round((landingTop - (activeRect?.top ?? 0)) * 10) / 10,
  };

  // Coming out: the new parent is the root or one of the folders the row is
  // already inside (e.g. a sub-folder's row moving up to its parent's level).
  const parentOf = (id) => items.find((item) => item.id === id)?.parentId ?? null;
  let leaving = parentId === null;
  for (let ancestor = parentOf(intent.parentId); !leaving && ancestor; ancestor = parentOf(ancestor)) {
    if (ancestor === parentId) leaving = true;
  }

  let next;
  let wakeAt = null;
  if (parentId === intent.parentId || leaving || (stepped && targetIndex === committedIndex)) {
    // Same folder, coming out, or a clear sideways step: at once. A sideways
    // step re-anchors where it happened, so the next one is measured from
    // there; a depth change from moving up / down keeps the old anchor (a
    // thumb's sideways wobble at that moment must not become the anchor).
    next = {
      ...intent,
      ...candidate,
      anchorX: stepped ? dx : intent.anchorX,
      pending: null,
    };
  } else {
    // Going into a folder must REST on one slot for the dwell.
    const key = `in:${parentId}:${candidate.overId}`;
    const stillLimit = shift * BOOKMARK_DWELL_STILL_RATIO;
    const restarted = !intent.pending
      || intent.pending.key !== key
      || Math.abs(centerY - intent.pending.y) > stillLimit;
    const pending = restarted
      ? { key, since: now, y: centerY, parentId }
      : intent.pending;
    if (now - pending.since >= dwellMs) {
      next = { ...intent, ...candidate, anchorX: dx, pending: null };
    } else {
      next = {
        ...intent,
        pending: { ...pending, intoId: parentId },
      };
      wakeAt = pending.since + dwellMs;
    }
  }

  return { intent: sameIntent(next, intent) ? intent : next, wakeAt };
};

export const getAutoExpandTargetFolder = (items, activeId, overId, dragOffset) => {
  if (dragOffset < GROUP_AUTO_EXPAND_OFFSET_PX) return null;

  const overItemIndex = items.findIndex(({ id }) => id === overId);
  const activeItemIndex = items.findIndex(({ id }) => id === activeId);
  if (overItemIndex === -1 || activeItemIndex === -1) return null;

  const reorderedItems = arrayMoveBookmarkItems(items, activeItemIndex, overItemIndex);
  const reorderedOverIndex = reorderedItems.findIndex(({ id }) => id === overId);
  const candidates = [
    items[overItemIndex],
    items[overItemIndex - 1],
    items[overItemIndex + 1],
    reorderedItems[reorderedOverIndex],
    reorderedItems[reorderedOverIndex - 1],
    reorderedItems[reorderedOverIndex + 1],
  ].filter((item, index, list) => item && list.findIndex((candidate) => candidate?.id === item.id) === index);

  return candidates.find((item) => (
    item?.type === 'folder' &&
    item.id !== activeId &&
    item.collapsed &&
    item.children?.length > 0
  )) ?? null;
};

export const applyBookmarkTreeProjection = (tree, activeId, overId, projection) => {
  if (!projection || !activeId || !overId) return tree;

  const clonedItems = deepClone(flattenBookmarkTreeForSort(tree));
  const overIndex = clonedItems.findIndex(({ id }) => id === overId);
  const activeIndex = clonedItems.findIndex(({ id }) => id === activeId);
  if (overIndex === -1 || activeIndex === -1) return tree;

  clonedItems[activeIndex] = {
    ...clonedItems[activeIndex],
    depth: projection.depth,
    parentId: projection.parentId,
  };

  return buildSortableBookmarkTree(arrayMoveBookmarkItems(clonedItems, activeIndex, overIndex));
};

/**
 * Merge the shared tooltip binding with @dnd-kit's activator listeners for a
 * drag handle. Both sides want `onPointerDown` (the tooltip hides on press,
 * the PointerSensor starts the drag), and a plain spread lets whichever comes
 * last silently replace the other — KAL-65 spread the tooltip after the
 * listeners and every bookmark drag stopped starting. Chain them instead.
 */
export const mergeDragHandleProps = (tipProps = {}, listeners = {}) => {
  const merged = { ...tipProps, ...listeners };
  const tipPointerDown = tipProps.onPointerDown;
  const dragPointerDown = listeners.onPointerDown;
  if (tipPointerDown && dragPointerDown) {
    merged.onPointerDown = (event) => {
      tipPointerDown(event);
      dragPointerDown(event);
    };
  }
  return merged;
};
