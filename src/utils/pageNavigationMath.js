/**
 * pageNavigationMath.js — pure math behind the right rail's page and zoom
 * controls (page indicator, go-to-page field, typed zoom, fit modes).
 *
 * UX 2026-09-23 (owner: right rail audit): "if I type in a page number it
 * actually navigates there; whatever page I'm looking at actually shows
 * there; all the fitting math is correct." Every rule the rail depends on
 * lives here so it can be tested without a browser. The phone page counter
 * reads the same page state, so both surfaces follow these rules.
 */

/**
 * Which page counts as "the page you are looking at".
 *
 * Rule: the page with the largest VISIBLE FRACTION of its own height inside
 * the visible band. Ties (within 0.001) keep the current page when it is one
 * of the tied pages, otherwise the upper page wins. Reference behaviour
 * matched: the pdf.js reference viewer (most-visible page, and a page that
 * is still fully visible stays current).
 *
 * Why not the old viewport-midpoint rule: after a jump to page N (page top
 * at the top of the view), a page shorter than half the view put the
 * midpoint on page N+1, so the rail said N+1 right after you asked for N,
 * and Next then skipped a page.
 *
 * @param {object} args
 * @param {number[]} args.pageTops    page top edges, same space as viewTop
 * @param {number[]} args.pageHeights page heights, same units
 * @param {number} args.viewTop       top of the visible band
 * @param {number} args.viewBottom    bottom of the visible band
 * @param {number} [args.currentPage] 1-based page currently shown
 * @returns {number} 1-based page number (1 when nothing is laid out)
 */
export function pickCurrentPage({ pageTops, pageHeights, viewTop, viewBottom, currentPage = null }) {
  const count = Math.min(pageTops?.length || 0, pageHeights?.length || 0);
  if (count === 0) return 1;
  let best = -1;
  let bestFrac = -1;
  let currentFrac = -1;
  for (let i = 0; i < count; i += 1) {
    const top = pageTops[i];
    const h = pageHeights[i];
    if (!(h > 0)) continue;
    const visible = Math.min(top + h, viewBottom) - Math.max(top, viewTop);
    if (visible <= 0) continue;
    const frac = visible / h;
    if (i + 1 === currentPage) currentFrac = frac;
    if (frac > bestFrac + 0.001) { best = i; bestFrac = frac; }
  }
  if (best < 0) {
    // Nothing visible (a scroll position inside a gap band taller than the
    // view): fall back to the last page whose top is above the view bottom.
    let last = 0;
    for (let i = 0; i < count; i += 1) if (pageTops[i] <= viewBottom) last = i;
    return last + 1;
  }
  if (currentFrac >= 0 && currentFrac >= bestFrac - 0.001) return currentPage;
  return best + 1;
}

/**
 * The go-to-page field's commit rule. Digits are read as a page number and
 * clamped into 1..numPages (typing 99 in a 36-page document goes to 36,
 * typing 0 goes to 1). Anything without digits returns null = cancel.
 */
export function resolvePageInput(raw, numPages) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  const value = parseInt(digits, 10);
  if (!Number.isFinite(value)) return null;
  const max = Number(numPages);
  if (!(max >= 1)) return null;
  return Math.min(Math.max(value, 1), Math.floor(max));
}

export const ZOOM_INPUT_MIN_PERCENT = 1;
export const ZOOM_INPUT_MAX_PERCENT = 4000;

/**
 * Keystroke filter for the typed zoom field: digits and ONE decimal point.
 * "150%" -> "150", "12.5" -> "12.5" (it used to become "125", a 10x error),
 * values above the engine maximum show as "4000".
 */
export function sanitizeZoomInput(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  const single = dot < 0 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, '')}`;
  const numeric = parseFloat(single);
  if (Number.isFinite(numeric) && numeric > ZOOM_INPUT_MAX_PERCENT) return String(ZOOM_INPUT_MAX_PERCENT);
  return single;
}

/** Typed zoom -> percent clamped to 1..4000, or null (cancel). */
export function parseZoomPercentInput(raw) {
  const numeric = parseFloat(sanitizeZoomInput(raw));
  if (!Number.isFinite(numeric)) return null;
  return Math.min(Math.max(numeric, ZOOM_INPUT_MIN_PERCENT), ZOOM_INPUT_MAX_PERCENT);
}

/**
 * Fit-mode scale for ONE page (the current page), in the viewer's layout
 * units. Page gaps scale with zoom (gap is the base at 100%), so a page that
 * "fits" vertically shows its own gap above and below — the same margin page
 * 1 has at the top of the document.
 *
 *   fitWidth  = (viewportW - 2*padX [capped by maxPageWidth]) / pageW
 *   fitHeight = (viewportH - padTop - padBottom) / (pageH + 2*gap)
 *   fitPage   = min(fitWidth, fitHeight)
 */
export function computeFitScale({
  mode,
  pageW,
  pageH,
  viewportW,
  viewportH,
  padX = 0,
  gap = 0,
  padTop = 0,
  padBottom = 0,
  maxPageWidth = null,
}) {
  const availableW = Math.max(1, Number(viewportW) - padX * 2);
  const fitW = (maxPageWidth ? Math.min(availableW, maxPageWidth) : availableW) / pageW;
  const fitH = Math.max(1, Number(viewportH) - padTop - padBottom) / (pageH + 2 * gap);
  if (mode === 'fitWidth') return fitW;
  if (mode === 'fitHeight') return fitH;
  return Math.min(fitW, fitH);
}
