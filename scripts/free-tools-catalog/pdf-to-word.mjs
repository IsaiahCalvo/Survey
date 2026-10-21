import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-word', batch: true, group: 'from-pdf', name: 'PDF to Word', icon: 'word',
  short: 'Turn a PDF into a Word file you can edit.',
  title: 'PDF to Word converter free, no upload | Survey',
  desc: 'Turn a PDF into a Word file (.docx) you can edit. Keeps paragraphs, headings, lists and bold text. Free, in your browser, no upload.',
  h1: 'PDF to Word',
  lede: 'Get the text of a PDF into a Word file you can edit. Best for documents that are mostly text. Layout, tables and drawings are not kept. Scanned pages need <a href="/tools/ocr-pdf">OCR PDF</a> first.',
  accept: 'pdf', multiple: false, action: 'Make Word file',
  steps: ['Choose a PDF.', 'Press Make Word file.', 'Save the .docx file and open it in Word, Google Docs or Pages.'],
  trade: {
    h2: 'Specs and RFIs into Word',
    text: 'Turn a spec section, an RFI or meeting minutes into a Word file. Mark changes, reuse the wording or answer line by line. Scanned pages have no text, so run <a href="/tools/ocr-pdf">OCR PDF</a> first.',
    keys: 'spec specs specifications rfi rfis meeting minutes edit',
  },
  faq: [
    ['What does it keep?', 'The words, in paragraphs, with headings, lists, bold text and text sizes. Each PDF page starts a new page in Word.'],
    ['What does it not keep?', 'Layout, columns, tables, pictures and drawings. Table cells come out as text split by tabs. It works best on documents that are mostly text.'],
    ['Why is my Word file empty?', 'A scanned PDF is a picture of the page, so it has no text. Run OCR PDF on it first, then try again.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
