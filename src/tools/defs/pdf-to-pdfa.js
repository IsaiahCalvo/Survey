// PDF to PDF/A (PDF/A-2b) with no server: each page becomes a picture, with
// its words laid on top as hidden text. Words come from the page itself when
// it has them, otherwise (scans) from the OCR reader.
import {
  SEG, base, pdfOut, renderPage, releaseCanvas, canvasToBytes, ToolError,
} from '../kit.js';

async function convert(file, opts, progress) {
  const [{ startPdfA, pdfjsWords }, { hasRealText }] = await Promise.all([import('../pdfa.js'), import('../ocr.js')]);
  const pdf = await file.pdfjs();
  const writer = await startPdfA({ title: base(file.name) });
  let reader = null;
  try {
    for (let i = 0; i < file.pages; i += 1) {
      progress(`Page ${i + 1} of ${file.pages}`);
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      const text = await page.getTextContent().catch(() => null);
      page.cleanup();
      // One page at a time: render, squeeze to JPEG, let the canvas go.
      const canvas = await renderPage(pdf, i, { scale: Number(opts.dpi) / 72 });
      const jpeg = await canvasToBytes(canvas, 'image/jpeg', 0.85);
      releaseCanvas(canvas);
      let ocr = null;
      if (opts.ocr && !hasRealText(text)) {
        if (!reader) {
          const { makePageReader } = await import('../ocr-browser.js');
          reader = makePageReader(pdf, { skipText: false, progress });
        }
        progress(`Page ${i + 1} of ${file.pages}: reading the words`);
        ocr = await reader.readPage(i);
      }
      await writer.addPage({ jpeg, width: vp.width, height: vp.height, words: pdfjsWords(text?.items, vp.transform, vp.height), ocr });
    }
    progress('Making the PDF/A');
    const bytes = await writer.finish();
    const out = pdfOut(`${base(file.name)}-pdfa.pdf`, bytes);
    const { pages, searchable } = writer.stats;
    const blank = pages - searchable;
    if (blank >= pages) out.note = 'PDF/A-2b. Each page is now a picture. No words were found, so it can\'t be searched.';
    else out.note = `PDF/A-2b. Each page is now a picture with hidden text you can search${blank > 0 ? `; ${blank} of ${pages} pages had no words to keep` : ''}.`;
    return out;
  } finally {
    await reader?.close();
  }
}

export default {
  view: 'files',
  options: [
    { key: 'dpi', label: 'Picture quality', type: SEG, def: '150', choices: [['100', 'Small'], ['150', 'Normal'], ['200', 'High']] },
    { key: 'ocr', label: 'Read the words on scanned pages', type: 'check', def: true },
  ],
  notice(files) {
    const pages = files.reduce((n, f) => n + (f.pages || 0), 0);
    return pages > 30 ? `${pages} pages may take a few minutes, longer if they are scans. Keep this tab open.` : null;
  },
  async run(files, opts, progress) {
    if (!files.length) throw new ToolError('Add a PDF first.');
    const out = [];
    for (let n = 0; n < files.length; n += 1) {
      const tell = files.length > 1 ? (msg) => progress(`File ${n + 1} of ${files.length}: ${msg}`) : progress;
      out.push(await convert(files[n], opts, tell));
    }
    return out;
  },
};
