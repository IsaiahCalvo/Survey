import { placeSpreadPages } from './pageSpreads.js';

/**
 * Keep physical page indices while removing hidden Spaces pages from layout.
 * `spread` ('double' / 'cover', Nightly 'page-spreads') sets pages side by side
 * in rows (utils/pageSpreads.js); both pages of a row get the row's top, and
 * `place` says where each sits in its row. Single returns place: null and the
 * stack is the page list itself.
 */
export function buildVisiblePageStack({ pageSizes, visiblePageNumbers = null, rotation = 0, scale = 1, padTop = 0, gap = 0, spread = 'single' }) {
  const visible = Array.isArray(visiblePageNumbers) ? new Set(visiblePageNumbers.map(Number)) : null;
  const sideways = rotation === 90 || rotation === 270;
  const dims = pageSizes.map((size, index) => {
    if (visible && !visible.has(index + 1)) return { w: 0, h: 0, hidden: true };
    return sideways ? { w: size.h, h: size.w } : { w: size.w, h: size.h };
  });
  const place = placeSpreadPages(dims, spread, gap);
  const stack = place ? place.stack : dims;
  let height = padTop + gap * scale;
  let widestPt = 0;
  const rowTops = stack.map((dim) => {
    const top = height;
    if (!dim.hidden) {
      height += dim.h * scale + gap * scale;
      widestPt = Math.max(widestPt, dim.w);
    }
    return top;
  });
  const tops = place ? rowTops.map((_, index) => rowTops[place.leader[index]]) : rowTops;
  return { dims, tops, height, widestPt, stack, place };
}
