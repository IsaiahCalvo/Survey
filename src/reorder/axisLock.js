/**
 * axisLock.js — the two dnd-kit modifiers that keep a dragged item on one axis.
 *
 * KAL-84 (2026-10-13): four surfaces each carried their own copy of these
 * one-liners (TabBar and the template module tabs: horizontal; the shared
 * SortableRearrangeList and the Pages panel: vertical). One home here, same
 * behaviour: the other axis of the drag transform is pinned to 0.
 */
export const restrictToHorizontalAxis = ({ transform }) => ({
  ...transform,
  y: 0,
});

export const restrictToVerticalAxis = ({ transform }) => ({
  ...transform,
  x: 0,
});
