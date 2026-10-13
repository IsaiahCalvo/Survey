// Page thumbnails and the contact sheet for the review bundle (KAL-410).
//
// Drawn from the SAME annotated bytes the PDF export builds, so a thumbnail
// shows exactly what the exported PDF shows. pdf.js renders them with the
// off-screen 'print' intent (renderPdfPageForExport: never stalls on a hidden
// window). 'print' only paints annotations marked printable, and some of the
// app's writers leave that flag off, so a scratch copy gets the flag first.
// The scratch copy is thrown away; nothing here touches any saved file.

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

export const THUMBNAIL_WIDTH = 320;
export const MAX_THUMBNAIL_PAGES = 60;
export const SHEET_COLUMNS = 3;
const GAP = 16;
const LABEL_H = 22;

const HIDDEN_FLAGS = 1 | 2 | 32; // invisible, hidden, noview

export async function withPrintableAnnotations(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (const entry of annots.asArray()) {
      const dict = doc.context.lookup(entry);
      if (!(dict instanceof PDFDict)) continue;
      const flags = dict.lookup(PDFName.of('F'));
      const value = flags instanceof PDFNumber ? flags.asNumber() : 0;
      if (value & HIDDEN_FLAGS) continue;
      dict.set(PDFName.of('F'), PDFNumber.of(value | 4));
    }
  }
  return doc.save();
}

export const thumbnailName = (pageNumber) => `thumbnails/page-${String(pageNumber).padStart(3, '0')}.png`;

const browserCanvas = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};
const browserPng = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob(async (blob) => {
    if (!blob) return reject(new Error('Could not draw a page picture'));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, 'image/png');
});

/**
 * @param {object} args
 * @param {Uint8Array} args.annotatedBytes  the PDF export's bytes
 * @param {number[]} args.pageNumbers       1-based pages to draw
 * @param {object} [args.pdfjs]             pdf.js module (default: the app's loader)
 * @param {Function} [args.renderPage]      default: renderPdfPageForExport
 * @param {Function} [args.createCanvas]    (w, h) => canvas
 * @param {Function} [args.toPng]           (canvas) => Promise<Uint8Array>
 * @returns {Promise<{ files: {name, data}[], pages: number[], truncated: boolean }>}
 */
export async function renderBundleThumbnails({
  annotatedBytes,
  pageNumbers,
  pdfjs = null,
  renderPage = null,
  createCanvas = browserCanvas,
  toPng = browserPng,
}) {
  const wanted = [...new Set(pageNumbers)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!wanted.length) return { files: [], pages: [], truncated: false };
  const pages = wanted.slice(0, MAX_THUMBNAIL_PAGES);
  const lib = pdfjs || await (await import('../pdfWorkerConfig.js')).loadPdfjs();
  const render = renderPage || (await import('../spacePdfPageRender.js')).renderPdfPageForExport;
  const printable = await withPrintableAnnotations(annotatedBytes);
  const task = lib.getDocument({ data: printable, isEvalSupported: false });
  const doc = await task.promise;
  const files = [];
  const drawn = [];
  try {
    for (const pageNumber of pages) {
      if (pageNumber > doc.numPages) continue;
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / base.width });
      const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await render({ page, canvasContext: ctx, viewport, pageNumber });
      files.push({ name: thumbnailName(pageNumber), data: await toPng(canvas) });
      drawn.push({ pageNumber, canvas });
      page.cleanup?.();
    }
    if (drawn.length) {
      files.push({ name: 'thumbnails/contact-sheet.png', data: await toPng(drawSheet(drawn, createCanvas)) });
    }
  } finally {
    await task.destroy();
  }
  return { files, pages: drawn.map((d) => d.pageNumber), truncated: wanted.length > pages.length };
}

// One picture with every drawn page in a grid, each labelled "Page N".
function drawSheet(drawn, createCanvas) {
  const cols = Math.min(SHEET_COLUMNS, drawn.length);
  const rows = Math.ceil(drawn.length / cols);
  const cellH = Math.max(...drawn.map((d) => d.canvas.height)) + LABEL_H;
  const sheet = createCanvas(GAP + cols * (THUMBNAIL_WIDTH + GAP), GAP + rows * (cellH + GAP));
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  ctx.font = '13px Helvetica';
  ctx.textBaseline = 'middle';
  drawn.forEach(({ pageNumber, canvas }, index) => {
    const x = GAP + (index % cols) * (THUMBNAIL_WIDTH + GAP);
    const y = GAP + Math.floor(index / cols) * (cellH + GAP);
    ctx.fillStyle = '#222222';
    ctx.fillText(`Page ${pageNumber}`, x, y + LABEL_H / 2);
    ctx.drawImage(canvas, x, y + LABEL_H);
    ctx.strokeStyle = '#bbbbbb';
    ctx.strokeRect(x + 0.5, y + LABEL_H + 0.5, canvas.width - 1, canvas.height - 1);
  });
  return sheet;
}
