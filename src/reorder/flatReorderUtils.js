/**
 * flatReorderUtils.js — pure array-reorder helpers for drag-rearrange lists.
 *
 * Exports moveItem, getActiveOverIndices, moveItemById, moveVisibleItemById,
 * and moveScopedItem — immutable functions that translate dnd-kit active/over
 * ids into reordered arrays, including filtered-subset reordering that splices
 * results back into the full source list. Consumed by SortableRearrangeList
 * onReorder handlers.
 */
export const moveItem = (items, fromIndex, toIndex) => {
  if (!Array.isArray(items)) return items;
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const nextItems = items.slice();
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
};

export const getActiveOverIndices = (items, activeId, overId, getId = (item) => item.id) => {
  if (!Array.isArray(items) || activeId == null || overId == null) {
    return { fromIndex: -1, toIndex: -1 };
  }

  return {
    fromIndex: items.findIndex((item) => getId(item) === activeId),
    toIndex: items.findIndex((item) => getId(item) === overId),
  };
};

export const moveItemById = (items, activeId, overId, getId = (item) => item.id) => {
  const { fromIndex, toIndex } = getActiveOverIndices(items, activeId, overId, getId);
  return moveItem(items, fromIndex, toIndex);
};

export const moveVisibleItemById = (
  sourceItems,
  visibleIds,
  activeId,
  overId,
  getId = (item) => item.id,
) => {
  if (!Array.isArray(sourceItems) || !Array.isArray(visibleIds)) return sourceItems;
  const visibleIdSet = new Set(visibleIds);
  const visibleItems = sourceItems.filter((item) => visibleIdSet.has(getId(item)));
  const reorderedVisibleItems = moveItemById(visibleItems, activeId, overId, getId);

  if (reorderedVisibleItems === visibleItems) return sourceItems;

  let visibleIndex = 0;
  return sourceItems.map((item) => (
    visibleIdSet.has(getId(item)) ? reorderedVisibleItems[visibleIndex++] : item
  ));
};

export const moveScopedItem = (
  sourceItems,
  scopePredicate,
  activeId,
  overId,
  getId = (item) => item.id,
) => {
  if (!Array.isArray(sourceItems) || typeof scopePredicate !== 'function') return sourceItems;
  const visibleIds = sourceItems.filter(scopePredicate).map(getId);
  return moveVisibleItemById(sourceItems, visibleIds, activeId, overId, getId);
};
