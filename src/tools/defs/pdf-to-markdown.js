// PDF to Markdown: the PDF's text as .md, with headings, lists and page breaks.
import { base } from '../kit.js';
import { readPdfText, toMarkdown, MD_TYPE } from '../pdfParagraphs.js';

export default {
  view: 'pages',
  async run([file], opts, progress) {
    const pages = await readPdfText(await file.pdfjs(), (i, n) => progress(`Page ${i + 1} of ${n}`));
    return [{ name: `${base(file.name)}.md`, bytes: new TextEncoder().encode(toMarkdown(pages)), type: MD_TYPE }];
  },
};
