// PDF to Word: the PDF's text as an editable .docx, a page break per page.
import { base } from '../kit.js';
import { readPdfText, toDocx, DOCX_TYPE } from '../pdfParagraphs.js';

export default {
  view: 'pages',
  async run([file], opts, progress) {
    const pages = await readPdfText(await file.pdfjs(), (i, n) => progress(`Page ${i + 1} of ${n}`));
    progress('Writing the Word file');
    return [{ name: `${base(file.name)}.docx`, bytes: toDocx(pages), type: DOCX_TYPE }];
  },
};
