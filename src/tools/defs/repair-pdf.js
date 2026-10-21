import {
  SEG, base, pdfOut, openPdfjs, renderPage, canvasToBytes, releaseCanvas, runQpdf,
} from '../kit.js';

// Pictures for the last-resort rebuild: 150 DPI JPEGs, one page at a time so
// only one canvas is alive at once.
async function drawPages(bytes, onPage) {
  const pdf = await openPdfjs(bytes);
  try {
    const out = [];
    for (let i = 0; i < pdf.numPages; i += 1) {
      onPage(i, pdf.numPages);
      try {
        const page = await pdf.getPage(i + 1);
        const { width, height } = page.getViewport({ scale: 1 });
        const canvas = await renderPage(pdf, i, { scale: 150 / 72 });
        out.push({ bytes: await canvasToBytes(canvas, 'image/jpeg', 0.85), type: 'jpg', width, height });
        releaseCanvas(canvas);
      } catch { /* a page pdf.js can't draw either; leave it out */ }
    }
    return out;
  } finally {
    // pdf.js 6 moved destroy() from the document to its loading task.
    (pdf.loadingTask || pdf).destroy?.();
  }
}

export default {
  view: 'files', openAnyway: true,
  options: [
    { key: 'mode', label: 'How', type: SEG, def: 'auto', choices: [['auto', 'Fix the file'], ['images', 'Rebuild from pictures']] },
  ],
  async run([file], opts, progress) {
    const { repairPdf } = await import('../repair.js');
    const r = await repairPdf(file.bytes, {
      run: runQpdf, draw: drawPages, mode: opts.mode, expected: file.pages, progress,
    });
    return [{ ...pdfOut(`${base(file.name)}-repaired.pdf`, r.bytes), note: r.note }];
  },
};
