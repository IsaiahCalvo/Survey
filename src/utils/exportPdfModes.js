// Export PDF choices (owner 2026-10-26: "export PDFs as annotated PDFs, as
// just the PDF without annotations, as flattened, and some other stuff like
// that"). Nightly only, behind the 'export-modes' flag.
//
// Marks:
//   annotated - marks are real PDF markups: Acrobat, Bluebeam and Survey can
//               still move, edit or delete them (the one-click Export).
//   flattened - marks are burned into the page, the same picture Print makes.
//   plain     - the drawing with no marks at all, also none the PDF came with.
// Pages: every page, the page on screen, only pages with marks, or a typed
// list like "1-3, 6".
// No pdf-lib here, so the chrome can import it; the byte work is in
// exportPdfBytes.js, loaded at export time.

export const OPEN_EXPORT_PDF_EVENT = 'survey-open-export-pdf';

export const EXPORT_MARK_MODES = Object.freeze([
  { id: 'annotated', label: 'Annotated', short: 'Marks stay editable in Acrobat, Bluebeam and Survey.' },
  { id: 'flattened', label: 'Flattened', short: 'Marks are burned into the page, so nobody can move or delete them.' },
  { id: 'plain', label: 'Plain', short: 'Just the drawing, with no marks at all.' },
]);

export const EXPORT_PAGE_CHOICES = Object.freeze(['all', 'current', 'marked', 'custom']);

/**
 * "1-3, 6, 9-7" -> [1, 2, 3, 6, 7, 8, 9]. Returns { pages } or { error }.
 * Pages are 1-based and must exist; duplicates are dropped; order is page order.
 */
export function parsePageList(text, numPages) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'Type the pages to export, like 1-3, 6.' };
  const set = new Set();
  for (const part of raw.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) return { error: `"${part}" is not a page or a range like 2-5.` };
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > numPages) return { error: `This PDF has pages 1 to ${numPages}.` };
    for (let p = a; p <= b; p += 1) set.add(p);
  }
  return { pages: [...set].sort((x, y) => x - y) };
}

const hasObjects = (pageData) => Array.isArray(pageData?.objects) && pageData.objects.length > 0;

/** Pages (1-based) that carry any Survey mark: shapes, callouts or Survey Markers. */
export function pagesWithMarks({ annotationsByPage = {}, callouts = [], surveyMarkers = {} } = {}) {
  const pages = new Set();
  for (const [key, pageData] of Object.entries(annotationsByPage || {})) {
    const n = Number(key);
    if (Number.isFinite(n) && n >= 1 && hasObjects(pageData)) pages.add(n);
  }
  for (const callout of Array.isArray(callouts) ? callouts : []) {
    const n = Number(callout?.pageNumber ?? callout?.page);
    if (Number.isFinite(n) && n >= 1) pages.add(n);
  }
  for (const marker of Object.values(surveyMarkers || {})) {
    const n = Number(marker?.pageNumber);
    if (Number.isFinite(n) && n >= 1) pages.add(n);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * The pages to keep, or null for every page. Returns { pages } or { error }.
 */
export function pickExportPages({ choice = 'all', custom = '', numPages = 0, currentPage = 1, marked = [] } = {}) {
  if (choice === 'current') {
    const p = Math.min(Math.max(1, Number(currentPage) || 1), Math.max(1, numPages));
    return { pages: [p] };
  }
  if (choice === 'marked') {
    const pages = marked.filter((p) => p >= 1 && p <= numPages);
    return pages.length ? { pages } : { error: 'No page has marks yet.' };
  }
  if (choice === 'custom') return parsePageList(custom, numPages);
  return { pages: null };
}

/** "Plan A.pdf" + flattened + [3] -> "Plan A-flattened-p3.pdf". */
export function exportFileName(name, mode, pages = null) {
  const base = String(name || 'document').replace(/\.pdf$/i, '') || 'document';
  let range = '';
  if (Array.isArray(pages) && pages.length) {
    range = pages.length === 1 ? `-p${pages[0]}` : `-p${pages[0]}-${pages[pages.length - 1]}`;
  }
  return `${base}-${mode}${range}.pdf`;
}
