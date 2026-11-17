import { placeSpreadPages } from './pageSpreads.js';

/**
 * Keep physical page indices while removing hidden Spaces pages from layout.
 * `spread` ('double' / 'cover' / 'grid-N', Nightly 'page-spreads') sets pages side by side
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

/**
 * Continuous off (KAL-712, Drawboard's "Continuous mode" switch): the rows
 * the viewer turns through, as lists of 1-based page numbers, hidden Spaces
 * pages left out. Single: one page a row; Double / Cover: the pairs.
 */
export function pagedRows({ pageSizes, visiblePageNumbers = null, spread = 'single' }) {
  const visible = Array.isArray(visiblePageNumbers) ? new Set(visiblePageNumbers.map(Number)) : null;
  const dims = (pageSizes || []).map((size, index) => (visible && !visible.has(index + 1) ? { w: 0, h: 0, hidden: true } : size));
  const place = placeSpreadPages(dims, spread, 0);
  const rows = place ? place.rows : dims.map((dim, index) => (dim.hidden ? null : [index])).filter(Boolean);
  return rows.map((row) => row.map((index) => index + 1));
}

/**
 * The row a page sits in: its own row, else the first row after it, else the
 * last row (a page a Space hides). -1 when there are no rows.
 */
export function pagedRowIndex(rows, page) {
  if (!rows.length) return -1;
  const own = rows.findIndex((row) => row.includes(page));
  if (own >= 0) return own;
  const after = rows.findIndex((row) => row[0] > page);
  return after >= 0 ? after : rows.length - 1;
}

/**
 * How one row lays out on its own: a pair as Double (Cover's later pairs
 * included), a lone page in the view's own mode so it keeps its slot (Cover's
 * page 1 on the right, a last odd page on the left).
 */
export function pagedRowSpread(row, spread) {
  if (spread === 'single') return 'single';
  return row.length === 2 ? 'double' : spread;
}
