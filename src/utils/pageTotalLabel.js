/**
 * pageTotalLabel.js — the page total shown in the page counter.
 *
 * While a file is still loading its page count is 0 (or unknown); show a dash
 * then instead of "0" or a guessed "1", so the counter never reads "1 · 0".
 */
export const PAGE_TOTAL_UNKNOWN = '–';

export function formatPageTotal(numPages, activeSpaceHasNoPages = false) {
  if (activeSpaceHasNoPages) return '0';
  const count = Number(numPages);
  return Number.isFinite(count) && count > 0 ? String(Math.floor(count)) : PAGE_TOTAL_UNKNOWN;
}
