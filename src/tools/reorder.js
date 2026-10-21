// Page order changes that keep each page exactly as it is (links, markups and
// form fields included): reverse the order, or slip blank pages in. Pure
// pdf-lib, no DOM.
import { loadPdf } from './ops.js';
import { ToolError } from './errors.js';
import { freshDoc, saveDoc, visualSize } from './impose.js';

async function copyAll(bytes) {
  const src = await loadPdf(bytes);
  const out = await freshDoc();
  const pages = await out.copyPages(src, src.getPageIndices());
  return { out, pages };
}

export async function reversePdf(bytes) {
  const { out, pages } = await copyAll(bytes);
  if (pages.length < 2) throw new ToolError('This PDF has only one page, so there is nothing to reverse.');
  pages.reverse().forEach((p) => out.addPage(p));
  return saveDoc(out);
}

// The new page list as entries { page: i } (an original page) or
// { blank: i } (a blank page the size of original page i).
// where: 'each' (after every page), 'after' (after the pages in `after`, a set
// of 0-based indexes), 'start' or 'end'. `count` blanks go in at each spot.
export function blankPlan(pageCount, { where = 'each', after = [], count = 1 } = {}) {
  const n = Math.floor(Number(count));
  if (!(n >= 1 && n <= 50)) throw new ToolError('Add between 1 and 50 blank pages at a time.');
  const spots = new Set(where === 'each' ? Array.from({ length: pageCount }, (_, i) => i) : where === 'after' ? after : []);
  if (where === 'after' && !spots.size) throw new ToolError('Type the pages to add blank pages after, like 2, 5.');
  const blanks = (i) => Array.from({ length: n }, () => ({ blank: i }));
  const plan = where === 'start' ? blanks(0) : [];
  for (let i = 0; i < pageCount; i += 1) {
    plan.push({ page: i });
    if (spots.has(i)) plan.push(...blanks(i));
  }
  if (where === 'end') plan.push(...blanks(pageCount - 1));
  return plan;
}

export async function addBlankPages(bytes, options) {
  const { out, pages } = await copyAll(bytes);
  for (const step of blankPlan(pages.length, options)) {
    if (step.page !== undefined) {
      out.addPage(pages[step.page]);
    } else {
      // Same size and way round as the page it sits next to, as people see it.
      const { width, height } = visualSize(pages[step.blank]);
      out.addPage([width, height]);
    }
  }
  return saveDoc(out);
}
