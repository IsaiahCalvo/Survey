import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-pdfa', group: 'from-pdf', name: 'PDF to PDF/A', icon: 'pdf-to-pdfa',
  iconSvg: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  short: 'Make a PDF/A copy for long-term keeping.',
  title: 'Convert PDF to PDF/A free, no upload | Survey',
  desc: 'Make a PDF/A-2b copy of a PDF for records and archives. Pages become pictures with hidden text you can search. Free, in your browser, no upload.',
  h1: 'Convert PDF to PDF/A',
  lede: 'Make a PDF/A copy of a PDF for long-term records. Each page becomes a picture with hidden text, so it looks the same and you can still search it.',
  accept: 'pdf', multiple: true, action: 'Make PDF/A',
  steps: ['Choose one or more PDFs.', 'Pick the picture quality. Keep "Read the words on scanned pages" on so scans can be searched too.', 'Press Make PDF/A and save the new file.'],
  trade: {
    h2: 'Archive closeout documents and as-builts',
    text: 'Some owners and agencies ask for closeout documents, as-builts or permit sets as PDF/A. Make a copy here to hand over or keep with the project records.',
    keys: 'archive archival closeout as-builts records permit set long term iso',
  },
  faq: [
    ['What is PDF/A?', 'PDF/A is a kind of PDF made to be kept for years. Everything it needs to look right, like colors and fonts, is inside the file, and things that can break later, like scripts and links, are left out.'],
    ['Which PDF/A does it make?', 'PDF/A-2b, the level most archives and offices ask for. It checks out in veraPDF, a free PDF/A checker.'],
    ['Will my text still be selectable?', 'Each page becomes a picture, with the words laid over it as hidden text. You can still search and copy them, but the text is no longer sharp at high zoom and the file can be bigger than before.'],
    ['What happens to forms, links and comments?', 'They are drawn onto the page as they look now, so they no longer work as forms or links. Keep the original if you still need to edit it.'],
    ['What about scanned pages?', 'With "Read the words on scanned pages" on, scans are read so they can be searched too. That takes a few seconds a page and works for English text.'],
    PRIVATE, FREE, LIMIT,
  ],
};
