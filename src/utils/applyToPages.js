/**
 * Apply to pages on the mark menu (Nightly 'apply-to-pages', KAL-720).
 * Drawboard's More menu has Apply to Pages: a copy of the picked marks lands
 * at the same spot on other pages (a stamp, a cloud or a note on every
 * sheet). The copies are planned with the one clipboard's paste
 * (familyClipboard planFamilyPaste) and committed in one undo step.
 */

import { parsePageSet } from '../tools/ranges.js';

/**
 * The pages a request names, 1-based and sorted, without the page the marks
 * came from: { pages, error }. `mode` is 'all' or 'pages' (typed `text`, such
 * as "2-5, 8").
 */
export function applyToPagesTargets({ mode = 'all', text = '', pageCount = 0, sourcePage = null } = {}) {
  const count = Math.max(0, Math.floor(Number(pageCount) || 0));
  const source = Number(sourcePage);
  let pages = [];
  if (mode === 'pages') {
    try {
      pages = parsePageSet(text, count).map((index) => index + 1);
    } catch (error) {
      return { pages: [], error: error?.message || 'Type pages such as 2-5, 8.' };
    }
  } else {
    pages = Array.from({ length: count }, (_, index) => index + 1);
  }
  pages = pages.filter((page) => page !== source);
  if (pages.length === 0) {
    return { pages, error: count <= 1 ? 'This PDF has one page.' : 'Name at least one page other than this one.' };
  }
  return { pages, error: null };
}

/**
 * The clipboard as Apply to pages copies it: marks and callouts only. A
 * Survey Marker is a survey row (one per real thing) and a text highlight
 * belongs to the words under it, so both stay on their page. Null when
 * nothing is left to copy.
 */
export function applyToPagesClipboard(clipboard) {
  if (!clipboard || !Array.isArray(clipboard.items)) return null;
  const items = clipboard.items.filter((item) => (item?.kind === 'mark'
    ? item.object?.data?.type !== 'text-markup'
    : item?.kind === 'callout'));
  return items.length > 0 ? { ...clipboard, items } : null;
}

/** "Put on 1 page" / "Put on 12 pages". */
export function applyToPagesToast(pageCount) {
  return `Put on ${pageCount === 1 ? '1 page' : `${pageCount} pages`}`;
}
