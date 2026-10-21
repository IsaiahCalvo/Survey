import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'ocr-pdf', group: 'edit', name: 'OCR PDF', icon: 'ocr',
  iconSvg: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  short: 'Make a scanned PDF searchable.',
  title: 'OCR PDF: make a scanned PDF searchable free | Survey',
  desc: 'Turn a scanned PDF into one you can search and copy text from. Free OCR in your browser, no upload, and the pages look the same.',
  h1: 'OCR PDF: make a scan searchable',
  lede: 'Read the words on scanned pages and add them as hidden text, so you can search, select and copy. Your file stays on your device.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make searchable',
  steps: ['Choose a scanned PDF.', 'Press Make searchable. Each page is read on your device.', 'Save the new PDF, then search it with Ctrl+F or Cmd+F.'],
  faq: [
    ['What does OCR do?', 'OCR reads the letters in a picture of a page. This tool lays those words over the page as hidden text, so the page looks the same but you can search it and copy from it.'],
    ['Which languages can it read?', 'English only for now. Other languages that use the same letters may partly work, but accents and other alphabets may come out wrong.'],
    ['Will my pages look different?', 'No. The pages are not redrawn. The text sits on top, hidden, in the same place as the words in the scan.'],
    ['How long does it take?', 'A few seconds a page on a computer, longer on a phone. Pages that already have text are skipped unless you turn that off.'],
    ['Why can\'t it find some words?', 'Blurry, tilted, faint or very small scans are hard to read. Handwriting usually is not read. A clean scan at 300 DPI works best.'],
    ['Does it work offline?', 'After the first time. The reader downloads about 3 MB the first time you use it, and your browser keeps it for next time.'],
    PRIVATE, FREE, LIMIT,
  ],
};
