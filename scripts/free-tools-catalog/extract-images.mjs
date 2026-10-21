import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'extract-images', group: 'from-pdf', name: 'Extract images', icon: 'extract-images',
  iconSvg: '<rect x="3" y="3" width="13" height="13" rx="1.5"/><circle cx="7.5" cy="7.5" r="1.5"/><path d="M16 12l-4-4-9 8"/><path d="M14 20h7M18 17l3 3-3 3"/>',
  short: 'Save every picture inside a PDF.',
  title: 'Extract images from a PDF free, no upload | Survey',
  desc: 'Save every photo and picture inside a PDF as its own file, at full quality. Free, in your browser, with no upload.',
  h1: 'Extract images from a PDF',
  lede: 'Pull out the photos and pictures stored in a PDF. JPEGs come out as they are, the rest as PNG.',
  accept: 'pdf', multiple: false, action: 'Save images',
  steps: ['Choose a PDF.', 'Leave "Skip small images like icons" on to drop logos and icons, or turn it off to keep everything.', 'Press Save images. More than one picture comes as a ZIP.'],
  faq: [
    ['Do the pictures lose quality?', 'No. JPEG photos are copied out exactly as they are stored in the PDF. Other pictures are saved as PNG, which keeps every pixel.'],
    ['Why is a picture missing?', 'Small pictures like icons are skipped unless you turn that off. Text and lines drawn in the PDF are not pictures, so to save a whole page as an image use PDF to JPG or PDF to PNG.'],
    ['Will the same logo come out on every page?', 'No. A picture used on many pages is saved once.'],
    PRIVATE, FREE, LIMIT,
  ],
};
