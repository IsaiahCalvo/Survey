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
 * Pure (no React); every size is in PDF points at scale 1.
 */

export const PAGE_SPREAD_MODES = Object.freeze(['single', 'double', 'cover']);

export function normalizeSpreadMode(mode) {
  return PAGE_SPREAD_MODES.includes(mode) ? mode : 'single';
}

/**
 * Rows of page indexes (hidden pages left out).
 * @param {{w:number,h:number,hidden?:boolean}[]} dims
 * @param {'single'|'double'|'cover'} mode
 * @returns {number[][]}
 */
export function buildSpreadRows(dims, mode) {
  const shown = [];
  (dims || []).forEach((dim, index) => { if (dim && !dim.hidden) shown.push(index); });
  const spread = normalizeSpreadMode(mode);
  if (spread === 'single') return shown.map((index) => [index]);
  const rows = [];
  let start = 0;
  if (spread === 'cover' && shown.length > 0) {
    rows.push([shown[0]]);
    start = 1;
  }
  for (let k = start; k < shown.length; k += 2) {
    rows.push(shown.slice(k, k + 2));
  }
  return rows;
}

/**
 * Where each page sits in its row.
 * @returns {null | { leader: number[], offsetX: number[], stack: object[], rows: number[][] }}
 *   null for Single (the caller keeps the page list as the stack).
 *   leader[i]  the row's first page (i itself for a leader; i for hidden pages)
 *   offsetX[i] the page's left edge from the row's left edge, in points
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
  const stack = list.map(() => ({ w: 0, h: 0, hidden: true }));
  const rows = buildSpreadRows(list, spread);
  rows.forEach((row, rowIndex) => {
    const [first, second] = row;
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
  return { leader, offsetX, stack, rows };
}

/** The pages of the row a page sits in (one or two indexes). */
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
  if (!place) return currentPage + step;
  const index = Math.max(0, currentPage - 1);
  const lead = place.leader[index] ?? index;
  const rowIndex = place.rows.findIndex((row) => row[0] === lead);
  if (rowIndex < 0) return currentPage + step;
  const target = place.rows[Math.max(0, Math.min(place.rows.length - 1, rowIndex + (step > 0 ? 1 : -1)))];
  return target[0] + 1;
}
