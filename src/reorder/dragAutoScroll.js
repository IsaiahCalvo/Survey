/**
 * dragAutoScroll.js — the shared, calmer auto-scroll for every @dnd-kit reorder.
 *
 * UX 2026-09-30 (owner: "the user should feel super controlled with whatever
 * they're dragging around, and that goes for any drag and drop"). dnd-kit's
 * default auto-scroll starts in the outer 20% of the scroll box and runs at up
 * to 10px every 5ms (2000px/s). In a ~450px phone sheet that is a 90px band —
 * two rows — so parking a row second from the bottom sent the list flying.
 * Here the band is the outer 10% on the list's own axis only, and the top speed
 * is 4px / 5ms (800px/s at the very edge, ramping from 0 at the band's inner
 * line).
 */
export const CALM_LIST_AUTO_SCROLL = {
  threshold: { x: 0, y: 0.1 },
  acceleration: 4,
};

// Horizontal strips (document tabs, template module tabs).
export const CALM_STRIP_AUTO_SCROLL = {
  threshold: { x: 0.1, y: 0 },
  acceleration: 4,
};

/*
 * Every drag grip carries `data-drag-handle` (DragRearrangeHandle, the bookmark
 * grips). A gesture recogniser on an ancestor — e.g. a phone bottom sheet's
 * swipe-down-to-dismiss — must ignore any touch/pointer that starts inside
 * `[data-drag-handle]`, and while a reorder is live `body` carries
 * `drag-rearrange-dragging`.
 */
export const DRAG_HANDLE_SELECTOR = '[data-drag-handle]';
