import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-tiff', group: 'from-pdf', name: 'PDF to TIFF', icon: 'pdf-to-tiff',
  iconSvg: '<rect x="7" y="3" width="13" height="16" rx="1.5"/><path d="M4 6v14a1 1 0 0 0 1 1h11"/><path d="M10 15l3-4 2 2 2-3"/>',
  short: 'Save a PDF as one multi-page TIFF.',
  title: 'PDF to TIFF converter free, no upload | Survey',
  desc: 'Turn a PDF into one multi-page TIFF in color, gray or black and white, at 150 or 300 DPI. Free, in your browser, no upload.',
  h1: 'PDF to TIFF',
  lede: 'Save every page of a PDF in one TIFF file, the kind many scanning, fax and archive systems ask for.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make TIFF',
  steps: ['Choose a PDF.', 'Pick the quality and the colors. Tap pages to save only those.', 'Press Make TIFF and save the file.'],
  faq: [
    ['Do I get one file or one per page?', 'One TIFF with every page in it, which is what most systems that ask for TIFF expect.'],
    ['Which settings should I pick?', 'Normal (150 DPI) is fine for reading on screen. Pick High (300 DPI) for printing or archives. Black and white makes the smallest files and suits text and drawings.'],
    ['Is the TIFF compressed?', 'Yes, without losing anything (Deflate, also called ZIP compression), so it opens the same everywhere and stays a sensible size.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
