import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-rtf', group: 'from-pdf', name: 'PDF to RTF', icon: 'pdf-to-rtf',
  iconSvg: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5M8 12h8M8 15h8M8 18h5"/>',
  short: 'Get the words of a PDF in an RTF file.',
  title: 'PDF to RTF converter free, no upload | Survey',
  desc: 'Turn the words of a PDF into an RTF file you can edit in Word, WordPad, Pages or LibreOffice. Free, in your browser, no upload.',
  h1: 'PDF to RTF',
  lede: 'Get the words out of a PDF as paragraphs in an RTF file, which almost every word processor opens and edits.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make RTF',
  steps: ['Choose a PDF.', 'Tap pages to use only those, and choose whether each PDF page starts a new page.', 'Press Make RTF and open the file in your word processor.'],
  trade: {
    h2: 'Reuse spec and contract wording',
    text: 'Pull the wording out of a spec section, scope of work or contract PDF so you can edit it in any word processor, instead of retyping it.',
    keys: 'spec section scope of work contract specifications editable text',
  },
  faq: [
    ['What comes across?', 'The words, in paragraphs, with headings kept bigger and bold. Tables, pictures and the exact layout stay in the PDF.'],
    ['Which programs open RTF?', 'Word, WordPad, Pages, LibreOffice and most other word processors.'],
    ['Why is my RTF empty?', 'The PDF is probably a scan, which is a picture of the page with no words in it. Run OCR PDF first, then try again.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
