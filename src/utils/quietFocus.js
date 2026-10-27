// Focus that should not pop a tooltip chip. When a dialog or menu closes, its
// focus trap hands focus back to the control that opened it; that is not the
// person moving focus, so the control's chip must stay hidden (design review
// 2026-10-27: after Esc closed Keyboard shortcuts, the rail button's chip
// stayed up beside it). The focus event fires inside el.focus(), so the mark
// only lives for that call.
const quiet = new WeakSet();

export function focusQuietly(el) {
  if (!el?.focus) return;
  quiet.add(el);
  try {
    el.focus();
  } finally {
    quiet.delete(el);
  }
}

export const isQuietFocus = (el) => quiet.has(el);
