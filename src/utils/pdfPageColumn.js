/**
 * pdfPageColumn.js — where each page of a mixed-size document sits across the
 * owned pdf.js viewer (PdfjsViewerContainer), and how far it scrolls sideways.
 *
 * UX (owner 2026-09-30: pinch zoom on the phone must feel like desktop, and
 * pages of different sizes must stay centred during and after zoom): every
 * page is centred on ONE shared vertical line — the middle of the document
 * column — and the whole document has ONE horizontal scroll range.
 *
 * The old rule centred a page that fitted the viewport but pinned a page that
 * overflowed to the left margin, with a scroll range per page. A narrow page
 * next to a wide one therefore sat off the wide page's centre, and because the
 * live pinch preview scales the whole document uniformly, a page crossing from
 * "fits" to "overflows" jumped sideways on release. With one centre line the
 * committed layout at any scale is exactly the uniform scale of the layout at
 * any other scale (about that line), so the preview and the commit agree for
 * every page.
 *
 * The column is the widest page plus the side margin (padX) on both sides, and
 * never narrower than the viewport. It grows continuously with zoom, so the
 * scroll range never jumps mid-gesture either.
 */

const finite = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** Width of the document column (excluding any side-panel room), in px. */
export function resolveDocumentColumnWidth({ viewportWidth = 0, widestPageWidth = 0, padX = 0 } = {}) {
  const viewport = Math.max(0, finite(viewportWidth));
  const widest = Math.max(0, finite(widestPageWidth));
  return Math.max(viewport, widest + 2 * Math.max(0, finite(padX)));
}

/**
 * A page's left edge in scroll-content px: centred in the column, behind any
 * left side-panel room (which sits in front of every page).
 */
export function resolveCentredPageLeft({ pageWidth = 0, columnWidth = 0, sideLeft = 0 } = {}) {
  return Math.max(0, finite(sideLeft)) + (finite(columnWidth) - Math.max(0, finite(pageWidth))) / 2;
}

/** The single horizontal scroll range of the whole document. */
export function resolveDocumentScrollLeftMax({ columnWidth = 0, viewportWidth = 0, sideLeft = 0, sideRight = 0 } = {}) {
  return Math.max(0, finite(sideLeft)) + Math.max(0, finite(sideRight))
    + Math.max(0, finite(columnWidth) - Math.max(0, finite(viewportWidth)));
}

/**
 * The column widened or narrowed at the SAME zoom (page sizes of a mixed
 * document arriving after the first page painted): move scrollLeft by half the
 * change so the centre line — and every page on it — holds still on screen.
 */
export function compensateScrollLeftForColumnWidth(scrollLeft, previousColumnWidth, nextColumnWidth) {
  return Math.max(0, finite(scrollLeft) + (finite(nextColumnWidth) - finite(previousColumnWidth)) / 2);
}
