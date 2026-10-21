import { PRIVATE, FREE } from '../free-tools-faq.mjs';

export default {
  id: 'docx-to-pdf', batch: true, group: 'to-pdf', name: 'DOCX to PDF', icon: 'word',
  short: 'Turn a .docx file into a PDF.',
  title: 'DOCX to PDF converter free, no upload | Survey',
  desc: 'Convert a .docx file to PDF in your browser. Keeps headings, lists, tables, links and pictures, with real text. Free, no sign-up, no upload.',
  h1: 'Convert DOCX to PDF',
  lede: 'Turn a .docx file into a PDF without uploading it. Best for letters, reports and specs.',
  accept: 'docx', multiple: false, action: 'Make PDF',
  steps: ['Choose a .docx file.', 'Pick the page size and font.', 'Press Make PDF and save it.'],
  trade: {
    h2: 'Meeting minutes and RFIs to PDF',
    text: 'Turn meeting minutes, an RFI or a submittal cover sheet saved as .docx into a PDF to send or file. For specs with headers, footers or columns, Word\'s own Save as PDF keeps those.',
    keys: 'meeting minutes rfi submittal cover sheet spec',
  },
  faq: [
    ['Is DOCX the same as Word?', 'Yes. .docx is the file type Word has saved since 2007. This page and Word to PDF do the same thing.'],
    ['Will it look exactly like Word?', 'Close for simple documents: headings, bold and italic text, lists, tables, links and pictures carry over. Text boxes, columns, shapes, charts and headers or footers don\'t, and the tool tells you when a file has them.'],
    ['Can it open old .doc files?', 'Not yet. Open the file in Word, Pages or Google Docs, save it as .docx, then try again.'],
    PRIVATE, FREE,
  ],
};
