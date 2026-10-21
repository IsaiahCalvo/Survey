// OCR PDF: read the words on scanned pages and lay them over the page as
// invisible text, so the PDF can be searched and copied from.
import { base, pdfOut } from '../kit.js';

export default {
  view: 'files',
  options: [
    { key: 'skipText', label: 'Skip pages that already have text', type: 'check', def: true },
  ],
  notice(files) {
    const pages = files.reduce((n, f) => n + (f.pages || 0), 0);
    return pages > 20 ? `Reading takes a few seconds a page, so ${pages} pages may take a while. Keep this tab open.` : null;
  },
  async run(files, opts, progress) {
    const [{ ocrPdf }, { makePageReader }] = await Promise.all([import('../ocr.js'), import('../ocr-browser.js')]);
    const out = [];
    for (let n = 0; n < files.length; n += 1) {
      const file = files[n];
      const prefix = files.length > 1 ? `File ${n + 1} of ${files.length}: ` : '';
      const reader = makePageReader(await file.pdfjs(), { skipText: opts.skipText, progress: (m) => progress(prefix + m) });
      try {
        const result = await ocrPdf(file.bytes, reader.readPage, (i, total) => progress(`${prefix}Page ${i + 1} of ${total}`));
        const note = result.skipped ? `${result.skipped} of ${result.pages} pages already had text and were left as they were.` : undefined;
        out.push({ ...pdfOut(`${base(file.name)}-searchable.pdf`, result.bytes), note });
      } finally {
        await reader.close();
      }
    }
    return out;
  },
};
