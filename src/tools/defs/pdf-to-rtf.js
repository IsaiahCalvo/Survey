// PDF to RTF: the words of each page as paragraphs in an RTF file, which Word,
// WordPad, Pages and LibreOffice all open. Layout, tables and pictures stay
// behind; the text is what comes across.
import { base, ToolError } from '../kit.js';
import {
  textLines, textParagraphs, markHeadings, bodySize,
} from '../pdfText.js';
import { writeRtf } from '../rtfWrite.js';

export default {
  view: 'pages',
  select: 'keep',
  hint: 'Every page is used. Tap pages to use only those.',
  options: [
    { key: 'pageBreaks', label: 'Start each PDF page on a new page', type: 'check', def: true },
  ],
  async run([file], opts, progress) {
    const pdf = await file.pdfjs();
    const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
    const pages = [];
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const page = await pdf.getPage(pick[n] + 1);
      const { items } = await page.getTextContent();
      page.cleanup();
      pages.push(textParagraphs(textLines(items)));
    }
    if (!pages.some((p) => p.length)) throw new ToolError('No text was found. This PDF may be a scan, which is a picture of the page. Try OCR PDF first.');
    progress('Writing the RTF');
    // Headings are measured against the whole file's usual text size.
    const body = bodySize(pages.flat());
    const bytes = writeRtf(pages.map((p) => markHeadings(p, body)), { title: base(file.name), pageBreaks: opts.pageBreaks });
    return [{ name: `${base(file.name)}.rtf`, bytes, type: 'application/rtf' }];
  },
};
