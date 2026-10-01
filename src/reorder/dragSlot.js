/*
 * DRAG SLOT (owner 2026-10-01: "a uniform colour / uniform style when it gets
 * picked up"). While a row is lifted, the gap it will land in shows one quiet
 * dashed outline (states.css `[data-drag-slot]::before`, tokens --drag-slot-*).
 *
 * The gap follows dnd-kit's vertical sorting strategy: moving DOWN, the rows in
 * between shift up and the lifted row lands with its bottom on the target
 * row's bottom; moving UP, they shift down and it lands with its top on the
 * target row's top. `rows` are the list's own rows measured when the drag
 * starts (before any transform), in list coordinates: { id, top, height }.
 */
export const getDragSlotRect = (rows, activeId, overId) => {
  if (!rows?.length) return null;
  const activeIndex = rows.findIndex((row) => row.id === String(activeId));
  if (activeIndex < 0) return null;
  const overIndex = overId == null ? -1 : rows.findIndex((row) => row.id === String(overId));
  const active = rows[activeIndex];
  const target = rows[overIndex < 0 ? activeIndex : overIndex];
  const top = overIndex > activeIndex ? target.top + target.height - active.height : target.top;
  return { top, height: active.height };
};
