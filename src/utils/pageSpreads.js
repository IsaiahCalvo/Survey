/**
 * pageSpreads.js — Double and Cover page views (Nightly 'page-spreads',
 * Drawboard PDF Pro push 2026-11-12, drawboard-trial/pdf-pro row C17).
 *
 * Drawboard's View settings: Single (one column), Double (pages side by side
 * in pairs, 1-2, 3-4 ...) and Cover (page 1 alone on the RIGHT, then 2-3,
 * 4-5 ... like an open book). The viewer still scrolls down; a row is two
 * pages wide and as tall as its taller page, and both pages of a row share
 * the row's top.
 *
 * The viewer works in "stack" terms: a list as long as the page list where a
 * row's first page (its leader) carries the row's width and height and the
 * other page of the row is hidden. Every height sum, anchor and fit that ran
 * over the page list runs over the stack instead, so Single (the stack IS the
 * page list) behaves exactly as before.
 *
 * Grid (KAL-707, Drawboard's View settings "Grid" with a column count) puts
 * 2 to 6 pages in a row, as 'grid-N'. It is Double with N pages a row.
 * 'grid-auto' (KAL-711, Drawboard's Auto switch) takes its column count from
 * the page count: the square root, rounded up (10 pages: 4, 30 pages: 6),
 * whatever the window or zoom, as Drawboard does.
 *
 * Horizontal (KAL-713, Drawboard's View settings "Horizontal") with Single
 * runs every page left to right in one row, as 'strip'. It is never a saved
 * choice: the viewer asks for it when the direction is Horizontal, the view
 * is Single and Continuous is on. Next / Previous still step one page.
 *
 * Horizontal with Double, Cover or Grid (KAL-716, Drawboard pictures 43 and
 * 44) turns the view on its side: a pair stands one above the other (1 over
 * 2), a Grid's N pages fill a column top to bottom, and the columns run left
 * to right in one row, as 'strip-double', 'strip-cover', 'strip-grid-N'. Each
 * page then has a y place in its column too (offsetY).
 *
 * Pure (no React); every size is in PDF points at scale 1.
 */

export const GRID_COLUMN_CHOICES = Object.freeze([2, 3, 4, 5, 6]);
export const DEFAULT_GRID_COLUMNS = 3;
export const PAGE_SPREAD_MODES = Object.freeze(['single', 'double', 'cover', ...GRID_COLUMN_CHOICES.map((n) => `grid-${n}`), 'grid-auto']);

export function normalizeSpreadMode(mode) {
  if (mode === 'grid') return `grid-${DEFAULT_GRID_COLUMNS}`;
  if (mode === 'strip') return mode;
  if (typeof mode === 'string' && mode.startsWith('strip-')) {
    const base = normalizeSpreadMode(mode.slice(6));
    return base === 'single' || base === 'strip' ? 'strip' : `strip-${base}`;
  }
  return PAGE_SPREAD_MODES.includes(mode) ? mode : 'single';
}

export function isGridMode(mode) {
  return normalizeSpreadMode(mode).startsWith('grid-');
}

/** The Horizontal form of a view: 'strip' for Single, 'strip-double' and so on. */
export function stripSpreadMode(mode) {
  const spread = normalizeSpreadMode(mode);
  if (spread === 'single' || spread.startsWith('strip')) return spread === 'single' ? 'strip' : spread;
  return `strip-${spread}`;
}

/** The view a Horizontal one turns on its side ('double' for 'strip-double'), else null. */
function stripBase(spread) {
  return spread.startsWith('strip-') ? spread.slice(6) : null;
}

/** Auto's column count for this many shown pages. */
export function autoGridColumns(pageCount) {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(0, Number(pageCount) || 0))));
}

/**
 * Pages a row holds in a Grid view; 0 when the view isn't a Grid. Auto needs
 * the shown page count.
 */
export function gridColumns(mode, pageCount = 0) {
  const spread = normalizeSpreadMode(mode);
  if (spread === 'grid-auto') return autoGridColumns(pageCount);
  const match = /^grid-(\d)$/.exec(spread);
  return match ? Number(match[1]) : 0;
}

/** Pages a row holds: 1 Single, 2 Double / Cover, N Grid. */
export function spreadRowSize(mode, pageCount = 0) {
  const spread = normalizeSpreadMode(mode);
  if (spread === 'single') return 1;
  if (spread.startsWith('strip')) return Math.max(1, Number(pageCount) || 0);
  return isGridMode(spread) ? gridColumns(spread, pageCount) : 2;
}

/**
 * Rows of page indexes (hidden pages left out).
 * @param {{w:number,h:number,hidden?:boolean}[]} dims
 * @param {string} mode 'single' | 'double' | 'cover' | 'grid-N' | 'strip'
 * @returns {number[][]}
 */
export function buildSpreadRows(dims, mode) {
  const shown = [];
  (dims || []).forEach((dim, index) => { if (dim && !dim.hidden) shown.push(index); });
  const spread = normalizeSpreadMode(mode);
  if (spread === 'single') return shown.map((index) => [index]);
  if (spread.startsWith('strip')) return shown.length ? [shown] : [];
  const size = spreadRowSize(spread, shown.length);
  const rows = [];
  let start = 0;
  if (spread === 'cover' && shown.length > 0) {
    rows.push([shown[0]]);
    start = 1;
  }
  for (let k = start; k < shown.length; k += size) {
    rows.push(shown.slice(k, k + size));
  }
  return rows;
}

/**
 * Where each page sits in its row.
 * @returns {null | { leader: number[], offsetX: number[], offsetY: number[], stack: object[], rows: number[][], strip: boolean }}
 *   null for Single (the caller keeps the page list as the stack).
 *   strip      true for Horizontal's one row of every page
 *   leader[i]  the row's first page (i itself for a leader; i for hidden pages)
 *   offsetX[i] the page's left edge from the row's left edge, in points
 *   offsetY[i] the page's top from the row's top, in points (0 but in a
 *              Horizontal Double, Cover or Grid, where pages stack in columns)
 *   stack[i]   { w, h } of the row on its leader, { w: 0, h: 0, hidden: true }
 *              on the other page of a row and on hidden pages
 */
export function placeSpreadPages(dims, mode, gapPt = 0) {
  const spread = normalizeSpreadMode(mode);
  if (spread === 'single') return null;
  const list = Array.isArray(dims) ? dims : [];
  const gap = Math.max(0, Number(gapPt) || 0);
  const leader = list.map((_, index) => index);
  const offsetX = list.map(() => 0);
  const offsetY = list.map(() => 0);
  const stack = list.map(() => ({ w: 0, h: 0, hidden: true }));
  const rows = buildSpreadRows(list, spread);
  const base = stripBase(spread);
  if (base) {
    // Horizontal Double / Cover / Grid: the vertical view's rows become
    // columns, side by side in one row as wide as the document.
    const columns = buildSpreadRows(list, base);
    const shown = rows[0] || [];
    const first = shown[0];
    let x = 0;
    let tallest = 0;
    columns.forEach((column, columnIndex) => {
      // A page alone keeps its pair slot, as across: Cover's page 1 low
      // (the open book's right-hand page, on its side).
      let y = base === 'cover' && columnIndex === 0 && column.length === 1 ? list[column[0]].h + gap : 0;
      let wide = 0;
      column.forEach((index) => {
        leader[index] = first;
        offsetX[index] = x;
        offsetY[index] = y;
        y += list[index].h + gap;
        wide = Math.max(wide, list[index].w);
      });
      tallest = Math.max(tallest, y - gap);
      x += wide + gap;
    });
    if (first != null) stack[first] = { w: x - gap, h: tallest };
    return { leader, offsetX, offsetY, stack, rows, strip: true, columns };
  }
  const strip = spread === 'strip';
  // A strip is a Grid row as long as the document.
  const grid = strip || isGridMode(spread);
  const shownCount = rows.reduce((n, row) => n + row.length, 0);
  const size = strip ? shownCount : grid ? gridColumns(spread, shownCount) : 2;
  rows.forEach((row, rowIndex) => {
    const [first, second] = row;
    if (grid) {
      // Grid: pages left to right with the gap between them. A short last
      // row keeps the full row's width (each empty slot as wide as the row's
      // first page) with its pages in the middle, as Drawboard does.
      const slot = list[first].w + gap;
      const empty = size - row.length;
      let x = (empty * slot) / 2;
      let h = 0;
      row.forEach((index) => {
        leader[index] = first;
        offsetX[index] = x;
        x += list[index].w + gap;
        h = Math.max(h, list[index].h);
      });
      stack[first] = { w: x - gap + (empty * slot) / 2, h };
      return;
    }
    const a = list[first];
    if (second == null) {
      // A page alone in its row keeps the slot it would have in a pair:
      // Cover's first page on the right (an open book's first page), a
      // last odd page on the left. The empty slot is as wide as the page.
      const onRight = spread === 'cover' && rowIndex === 0;
      offsetX[first] = onRight ? a.w + gap : 0;
      stack[first] = { w: a.w * 2 + gap, h: a.h };
      return;
    }
    const b = list[second];
    leader[second] = first;
    offsetX[first] = 0;
    offsetX[second] = a.w + gap;
    stack[first] = { w: a.w + gap + b.w, h: Math.max(a.h, b.h) };
  });
  return { leader, offsetX, offsetY, stack, rows, strip };
}

/** The pages of the row a page sits in (one index, or the whole row). */
export function rowMembers(place, index) {
  if (!place) return [index];
  const lead = place.leader[index] ?? index;
  return place.rows.find((row) => row[0] === lead) || [index];
}

/**
 * The page a step lands on: in a spread view Next / Previous move a whole
 * row (Drawboard), so the step from page 1 in Double is page 3.
 * @returns {number} 1-based page number
 */
export function steppedSpreadPage(place, currentPage, step) {
  // Horizontal's one row still steps one page.
  if (!place || place.strip) return currentPage + step;
  const index = Math.max(0, currentPage - 1);
  const lead = place.leader[index] ?? index;
  const rowIndex = place.rows.findIndex((row) => row[0] === lead);
  if (rowIndex < 0) return currentPage + step;
  const target = place.rows[Math.max(0, Math.min(place.rows.length - 1, rowIndex + (step > 0 ? 1 : -1)))];
  return target[0] + 1;
}
