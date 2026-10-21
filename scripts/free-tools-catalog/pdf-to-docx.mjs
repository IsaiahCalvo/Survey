import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

// Same tool as PDF to Word (src/tools/defs/pdf-to-docx.js re-exports it).
export default {
  id: 'pdf-to-docx', batch: true, group: 'from-pdf', name: 'PDF to DOCX', icon: 'word',
  short: 'Save a PDF as a .docx file.',
  title: 'PDF to DOCX converter free, no upload | Survey',
  desc: 'Save a PDF as a .docx file that opens in Word, Google Docs and Pages. Keeps paragraphs, headings and lists. Free, in your browser, no upload.',
  h1: 'PDF to DOCX',
  lede: 'Save the text of a PDF as a .docx file you can edit anywhere. Best for documents that are mostly text. Layout, tables and drawings are not kept. Scanned pages need <a href="/tools/ocr-pdf">OCR PDF</a> first.',
  accept: 'pdf', multiple: false, action: 'Make DOCX',
  steps: ['Choose a PDF.', 'Press Make DOCX.', 'Save the .docx file and open it in Word, Google Docs or Pages.'],
  trade: {
    h2: 'Edit a spec or a scope letter',
    text: 'Save a spec section, a scope letter or a punch list as .docx. Change the wording, add your notes and send it back. Scanned pages have no text, so run <a href="/tools/ocr-pdf">OCR PDF</a> first.',
    keys: 'spec specs specifications scope letter punch list edit',
  },
  faq: [
    ['Is DOCX the same as Word?', 'Yes. DOCX is the file type Word has used since 2007. Google Docs, Pages and LibreOffice open it too.'],
    ['What does it keep?', 'The words, in paragraphs, with headings, lists, bold text and text sizes. Each PDF page starts a new page.'],
    ['What does it not keep?', 'Layout, columns, tables, pictures and drawings. A scanned PDF has no text, so run OCR PDF on it first.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
