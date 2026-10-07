// Page changes to SEVERAL pages at once (owner 2026-10-07: "copy multiple,
// delete multiple, rearrange multiple, and drag multiple").
//
// Each helper turns "these pages" into the single-page operations that the
// page view (utils/pageViewDocument.js), the page-state remap
// (utils/pageAnnotationReindex.js) and the pdf-lib rewrite
// (utils/pdfPageMutation.js) already know, in the order they must run, and
// says which pages the result occupies (the new selection). usePageOperations
// runs the list as ONE batch: one view swap, one commit, one Undo step.
//
// Pure: no React, no DOM. Pages are 1-based numbers in the CURRENT order.

const uniqueSorted = (pages, pageCount = Infinity) => [...new Set(
  (Array.isArray(pages) ? pages : [pages])
    .map(Number)
    .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageCount),
)].sort((a, b) => a - b);

export const normalizePageSelection = uniqueSorted;

/** One operation, or a batch of several (null when there is nothing to do). */
export function batchOperation(operations) {
  const list = (operations || []).filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return { type: 'batch', operations: list };
}

// Longest increasing subsequence of `values` (as a Set of the values kept).
function longestIncreasing(values) {
  const tails = [];
  const tailIndex = [];
  const previous = new Array(values.length).fill(-1);
  values.forEach((value, index) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[index] = tailIndex[lo - 1];
    tails[lo] = value;
    tailIndex[lo] = index;
  });
  const kept = new Set();
  let index = tailIndex[tails.length - 1];
  while (index != null && index >= 0) {
    kept.add(values[index]);
    index = previous[index];
  }
  return kept;
}

/**
 * The page moves that turn the order 1..n into `finalOrder` (a permutation
 * of 1..n, by today's page numbers). Pages already in the right relative
 * order stay; each of the others is moved once, right after the page that
 * precedes it in the final order. Returns [{ type: 'move', from, to }].
 */
export function movesForOrder(finalOrder) {
  const order = Array.isArray(finalOrder) ? finalOrder.map(Number) : [];
  const stay = longestIncreasing(order);
  const current = [...order].sort((a, b) => a - b);
  const operations = [];
  order.forEach((page, index) => {
    if (stay.has(page)) return;
    const from = current.indexOf(page);
    current.splice(from, 1);
    const before = index > 0 ? current.indexOf(order[index - 1]) + 1 : 0;
    current.splice(before, 0, page);
    if (from !== before) operations.push({ type: 'move', from: from + 1, to: before + 1 });
  });
  return operations;
}

/**
 * Lift `pages` out (keeping their order) and put them back as one block at
 * `insertIndex` among the pages that stay (0 = before all of them).
 * Returns { order, operations, selection } — the final order by today's
 * numbers, the moves, and where the block now sits.
 */
export function movePagesToIndex(pageCount, pages, insertIndex) {
  const count = Number(pageCount) || 0;
  const block = uniqueSorted(pages, count);
  const lifted = new Set(block);
  const rest = [];
  for (let page = 1; page <= count; page += 1) if (!lifted.has(page)) rest.push(page);
  const at = Math.max(0, Math.min(rest.length, Number(insertIndex) || 0));
  const order = [...rest.slice(0, at), ...block, ...rest.slice(at)];
  return {
    order,
    operations: movesForOrder(order),
    selection: block.map((_, index) => at + index + 1),
  };
}

/**
 * Cut-and-paste of several pages: the block goes above or below `anchorPage`
 * (by today's numbers). An anchor inside the block keeps the block where that
 * page was.
 */
export function movePagesNextTo(pageCount, pages, anchorPage, position = 'below') {
  const block = new Set(uniqueSorted(pages, pageCount));
  const anchor = Number(anchorPage);
  let insertIndex = 0;
  for (let page = 1; page <= pageCount; page += 1) {
    if (block.has(page)) continue;
    if (page < anchor || (position !== 'above' && page === anchor)) insertIndex += 1;
  }
  return movePagesToIndex(pageCount, [...block], insertIndex);
}

/** Copies of `pages` (in order) pasted as a block after page `afterPage` (0 = top). */
export function copyPagesAfter(pageCount, pages, afterPage) {
  const sources = uniqueSorted(pages, pageCount);
  const slot = Math.max(0, Math.min(Number(pageCount) || 0, Number(afterPage) || 0));
  const operations = sources.map((source, index) => ({
    type: 'copy',
    // Each copy already pasted shifts the pages after the slot down by one.
    source: source <= slot ? source : source + index,
    afterPage: slot + index,
  }));
  return { operations, selection: sources.map((_, index) => slot + index + 1) };
}

/** Each page gets its copy right after it; the copies are the new selection. */
export function duplicatePages(pageCount, pages) {
  const sources = uniqueSorted(pages, pageCount);
  const operations = sources.map((page, index) => ({ type: 'duplicate', page: page + index }));
  return { operations, selection: sources.map((page, index) => page + index + 1) };
}

/** Delete, highest page first (the numbers below it do not move). */
export function deletePages(pageCount, pages) {
  const doomed = uniqueSorted(pages, pageCount);
  // A document keeps at least one page.
  if (doomed.length === 0 || doomed.length >= pageCount) return { operations: [], selection: [] };
  const operations = [...doomed].reverse().map((page) => ({ type: 'delete', page }));
  // What is left at the first deleted slot (or the page before it at the end).
  const first = Math.min(doomed[0], pageCount - doomed.length);
  return { operations, selection: [Math.max(1, first)] };
}

export function rotatePages(pageCount, pages, delta = 90) {
  const turned = uniqueSorted(pages, pageCount);
  return {
    operations: turned.map((page) => ({ type: 'rotate', page, delta: delta === -90 ? -90 : 90 })),
    selection: turned,
  };
}
