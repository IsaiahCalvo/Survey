/**
 * pdfPageCacheTrim.js — let pdf.js forget the pages nobody is looking at.
 *
 * Crash hunt 2026-10-07: pdf.js keeps everything it needed to draw a page
 * (the page's drawing instructions and its decoded images) on the page object
 * until the page's cleanup() is called, and the viewer never called it. Every
 * page ever drawn — on the canvas, as a far-zoom thumbnail, in the Pages
 * panel — stayed in memory until the document closed: ~55 MB for the 36
 * sheets of Package 2, growing with the page count of bigger sets. pdf.js's
 * own viewer keeps a small window of recent pages and cleans the rest; this
 * does the same.
 *
 * notePageDrawn(pdf, pageIndex) after each draw; pageMounted / pageUnmounted
 * around a page canvas being on screen. Pages on screen are never cleaned
 * (their next sharpen would have to fetch everything again); of the others
 * only the `keep` most recently drawn keep their data. cleanup() itself waits
 * for a draw that is still running (pdf.js defers it), and a cleaned page
 * simply fetches its data again the next time it is drawn.
 */

const recentByDoc = new WeakMap(); // pdf -> [pageIndex] (most recent last)
const mountedByDoc = new WeakMap(); // pdf -> Map(pageIndex -> count)

export const PAGE_CACHE_KEEP_MOBILE = 6;
export const PAGE_CACHE_KEEP_DESKTOP = 12;

function mountedCount(pdf, pageIndex) {
  return mountedByDoc.get(pdf)?.get(pageIndex) || 0;
}

function cleanPage(pdf, pageIndex) {
  let pending;
  try { pending = pdf.getPage(pageIndex + 1); } catch { return; }
  Promise.resolve(pending)
    .then((page) => { try { page?.cleanup?.(); } catch { /* a closed document */ } })
    .catch(() => { /* a closed document */ });
}

/** Drop the data of pages beyond the `keep` most recent ones (never a page on screen). */
export function trimPageCache(pdf, keep) {
  const list = recentByDoc.get(pdf);
  if (!list || !(keep >= 0)) return [];
  const cleaned = [];
  // Pages on screen do not count: `keep` is how many off-screen pages keep their data.
  let excess = list.filter((pageIndex) => mountedCount(pdf, pageIndex) === 0).length - keep;
  for (let i = 0; i < list.length && excess > 0;) {
    const pageIndex = list[i];
    if (mountedCount(pdf, pageIndex) > 0) { i += 1; continue; }
    list.splice(i, 1);
    excess -= 1;
    cleaned.push(pageIndex);
    cleanPage(pdf, pageIndex);
  }
  return cleaned;
}

export function notePageDrawn(pdf, pageIndex, keep) {
  if (!pdf || typeof pdf.getPage !== 'function' || !Number.isInteger(pageIndex)) return [];
  let list = recentByDoc.get(pdf);
  if (!list) { list = []; recentByDoc.set(pdf, list); }
  const at = list.indexOf(pageIndex);
  if (at >= 0) list.splice(at, 1);
  list.push(pageIndex);
  return trimPageCache(pdf, keep);
}

export function pageMounted(pdf, pageIndex) {
  if (!pdf || typeof pdf !== 'object') return;
  let map = mountedByDoc.get(pdf);
  if (!map) { map = new Map(); mountedByDoc.set(pdf, map); }
  map.set(pageIndex, (map.get(pageIndex) || 0) + 1);
}

export function pageUnmounted(pdf, pageIndex, keep) {
  const map = pdf && typeof pdf === 'object' ? mountedByDoc.get(pdf) : null;
  if (!map) return [];
  const next = (map.get(pageIndex) || 0) - 1;
  if (next > 0) map.set(pageIndex, next); else map.delete(pageIndex);
  return trimPageCache(pdf, keep);
}
