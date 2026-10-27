// Bring an element into view by scrolling ONLY the nearest list that scrolls
// up and down, never the panels and app frame around it.
//
// Owner note 2026-10-26 (item 38): with the Survey panel closed, placing a
// Survey Marker opened the panel and focused the new marker's name. The panel
// was still sliding in from off screen, so focus() / scrollIntoView() scrolled
// the app's overflow-hidden frame sideways to show it: the whole viewer jumped
// 272 px left for the length of the slide and then snapped back.
// focus({ preventScroll: true }) plus this keeps every outer box still.

const SCROLLS = /(auto|scroll|overlay)/;

export function findOwnScroller(el, stopAt = null) {
  let node = el?.parentElement || null;
  while (node && node !== stopAt && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (SCROLLS.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/** The scrollTop that shows [top, bottom] (in the scroller's content) with `margin` px to spare. */
export function resolveRevealScrollTop({ scrollTop = 0, viewHeight = 0, top = 0, bottom = 0, margin = 8 } = {}) {
  if (top - margin < scrollTop) return Math.max(0, top - margin);
  if (bottom + margin > scrollTop + viewHeight) return Math.max(0, Math.min(top - margin, bottom + margin - viewHeight));
  return scrollTop;
}

export function revealInOwnScroller(el, { margin = 8, stopAt = null } = {}) {
  if (!el || typeof window === 'undefined') return false;
  const scroller = findOwnScroller(el, stopAt);
  if (!scroller) return false;
  const box = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const top = box.top - view.top + scroller.scrollTop;
  const next = resolveRevealScrollTop({
    scrollTop: scroller.scrollTop,
    viewHeight: scroller.clientHeight,
    top,
    bottom: top + box.height,
    margin,
  });
  if (Math.abs(next - scroller.scrollTop) > 0.5) scroller.scrollTop = next;
  return true;
}
