// Align and distribute picked marks (Nightly flag 'align-marks', Drawboard
// PDF Pro trial audit 2026-11-09: its mark menu aligns and spaces a
// selection; Survey had neither). Pure part: boxes in, one move per box out.
//
// A box: { left, top, width, height } in page units. A move: { dx, dy }.

// The mark menu asks the page's layer to act: detail { pageNumber, op:
// 'align' | 'distribute', mode }.
export const ARRANGE_SELECTION_EVENT = 'survey:arrange-selection';

/** Ask the layer of `pageNumber` to align or distribute its picked marks. */
export function requestArrangeSelection(pageNumber, op, mode) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ARRANGE_SELECTION_EVENT, { detail: { pageNumber, op, mode } }));
}

export const ALIGN_MODES =['left', 'center', 'right', 'top', 'middle', 'bottom'];
export const DISTRIBUTE_MODES = ['horizontal', 'vertical'];

const finiteBox = (b) => b && [b.left, b.top, b.width, b.height].every(Number.isFinite);

/** The box around all the boxes, or null. */
export function unionBox(boxes) {
  const list = (boxes || []).filter(finiteBox);
  if (!list.length) return null;
  const left = Math.min(...list.map((b) => b.left));
  const top = Math.min(...list.map((b) => b.top));
  const right = Math.max(...list.map((b) => b.left + b.width));
  const bottom = Math.max(...list.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Line the boxes up on one edge or centre line of the box around them all.
 * Returns one { dx, dy } per input box (zero for a box that cannot move).
 * Needs two or more boxes; one box returns a zero move.
 */
export function planAlign(boxes, mode) {
  const list = boxes || [];
  const zero = list.map(() => ({ dx: 0, dy: 0 }));
  if (!ALIGN_MODES.includes(mode)) return zero;
  const valid = list.filter(finiteBox);
  if (valid.length < 2) return zero;
  const u = unionBox(valid);
  return list.map((b) => {
    if (!finiteBox(b)) return { dx: 0, dy: 0 };
    switch (mode) {
      case 'left': return { dx: u.left - b.left, dy: 0 };
      case 'center': return { dx: (u.left + u.width / 2) - (b.left + b.width / 2), dy: 0 };
      case 'right': return { dx: (u.left + u.width) - (b.left + b.width), dy: 0 };
      case 'top': return { dx: 0, dy: u.top - b.top };
      case 'middle': return { dx: 0, dy: (u.top + u.height / 2) - (b.top + b.height / 2) };
      case 'bottom': return { dx: 0, dy: (u.top + u.height) - (b.top + b.height) };
      default: return { dx: 0, dy: 0 };
    }
  });
}

/**
 * Even gaps between the boxes along one axis. The first and last box (by
 * position) stay put; the ones between move. Needs three or more boxes.
 * Boxes wider than the space between the ends still get equal (negative)
 * gaps, so the order along the axis never changes.
 */
export function planDistribute(boxes, mode) {
  const list = boxes || [];
  const zero = list.map(() => ({ dx: 0, dy: 0 }));
  if (!DISTRIBUTE_MODES.includes(mode)) return zero;
  const horizontal = mode === 'horizontal';
  const start = (b) => (horizontal ? b.left : b.top);
  const size = (b) => (horizontal ? b.width : b.height);
  const order = list
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => finiteBox(b))
    // Ties keep input order so the result is stable.
    .sort((a, c) => (start(a.b) + size(a.b) / 2) - (start(c.b) + size(c.b) / 2) || a.i - c.i);
  if (order.length < 3) return zero;
  const first = order[0].b;
  const last = order[order.length - 1].b;
  const span = (start(last) + size(last)) - start(first);
  const total = order.reduce((n, { b }) => n + size(b), 0);
  const gap = (span - total) / (order.length - 1);
  const out = zero.slice();
  let cursor = start(first) + size(first) + gap;
  for (let k = 1; k < order.length - 1; k += 1) {
    const { b, i } = order[k];
    const d = cursor - start(b);
    out[i] = horizontal ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    cursor += size(b) + gap;
  }
  return out;
}

/** True when every move is (close to) zero: the menu item would do nothing. */
export function isNoopPlan(moves, epsilon = 0.01) {
  return (moves || []).every((m) => Math.abs(m?.dx || 0) < epsilon && Math.abs(m?.dy || 0) < epsilon);
}
