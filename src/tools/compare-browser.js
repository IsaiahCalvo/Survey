// Browser side of Compare PDFs: read each page's words with pdf.js, and
// render page pairs small to spot areas that look different.
import { renderPage, releaseCanvas, canvasToBytes } from './browser.js';
import { wordsFromItems, changedAreas } from './compare.js';

export async function readPages(pdf, onPage) {
  const pages = [];
  for (let i = 0; i < pdf.numPages; i += 1) {
    onPage(i, pdf.numPages);
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(i + 1);
    let words = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      const tc = await page.getTextContent();
      words = wordsFromItems(tc.items);
    } catch { /* a page whose text can't be read counts as having none */ }
    pages.push({ view: [...page.view], rotate: ((page.rotate % 360) + 360) % 360, words });
    page.cleanup();
  }
  return pages;
}

// Long side of the small renders. Big enough to see a changed line on a
// drawing, small enough that 200 pages take seconds, not minutes.
const LOOK_SIDE = 900;

function pixels(canvas, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  releaseCanvas(c);
  return data;
}

// Areas that look different between two pages, or null when the pages are not
// the same shape (then a pixel compare means nothing).
export async function lookDiff(pdfA, a, pageA, pdfB, b, pageB) {
  const ra = aspect(pageA);
  const rb = aspect(pageB);
  if (Math.abs(ra - rb) / ra > 0.02) return null;
  const w = Math.round(ra >= 1 ? LOOK_SIDE : LOOK_SIDE * ra);
  const h = Math.round(ra >= 1 ? LOOK_SIDE / ra : LOOK_SIDE);
  const ca = await renderPage(pdfA, a, { width: w });
  const pa = pixels(ca, w, h);
  releaseCanvas(ca);
  const cb = await renderPage(pdfB, b, { width: w });
  const pb = pixels(cb, w, h);
  releaseCanvas(cb);
  return changedAreas(pa, pb, w, h);
}

function aspect({ view, rotate }) {
  const w = view[2] - view[0];
  const h = view[3] - view[1];
  return rotate % 180 ? h / w : w / h;
}

// A page pdf-lib can't copy goes into the report as a picture instead.
export async function pageImage(pdf, index) {
  const canvas = await renderPage(pdf, index, { scale: 2 });
  const bytes = await canvasToBytes(canvas, 'image/jpeg', 0.85);
  releaseCanvas(canvas);
  return { bytes, type: 'jpg' };
}
