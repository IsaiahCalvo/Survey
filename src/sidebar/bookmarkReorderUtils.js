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
  const newItems = arrayMoveBookmarkItems(items, activeItemIndex, overItemIndex);
  const previousItem = newItems[overItemIndex - 1];
  const nextItem = newItems[overItemIndex + 1];
  const canNestUnderPrevious = previousItem?.type === 'folder';
  const maxDepth = previousItem ? previousItem.depth + (canNestUnderPrevious ? 1 : 0) : 0;
  const minDepth = nextItem ? nextItem.depth : 0;
  const dragDepth = getDragDepth(dragOffset, indentationWidth);
  const projectedDepth = activeItem.depth + dragDepth;
  const depth = Math.max(minDepth, Math.min(projectedDepth, maxDepth));

  const getParentId = () => {
    if (depth === 0 || !previousItem) return null;
    if (depth === previousItem.depth) return previousItem.parentId;
    if (depth > previousItem.depth) {
      return previousItem.type === 'folder' ? previousItem.id : previousItem.parentId;
    }

    return newItems
      .slice(0, overItemIndex)
      .reverse()
      .find((item) => item.depth === depth)?.parentId ?? null;
  };

  return { depth, maxDepth, minDepth, parentId: getParentId() };
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

export const collectBookmarkTreePersistUpdates = (nextTree, currentBookmarks = []) => {
  const currentById = new Map((currentBookmarks || []).filter((item) => item?.id).map((item) => [item.id, item]));
  return flattenBookmarkTreeForSort(nextTree).reduce((updates, item) => {
    if (!item?.id) return updates;
    const parentId = item.parentId ?? null;
    const order = item.index;
    const previous = currentById.get(item.id);
    const previousParentId = previous?.parentId ?? null;
    const previousOrder = previous?.order;
    if (previous && previousParentId === parentId && previousOrder === order) {
      return updates;
    }
    updates.push({ id: item.id, updates: { order, parentId } });
    return updates;
  }, []);
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
