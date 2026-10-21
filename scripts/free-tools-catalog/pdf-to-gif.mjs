import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-gif', group: 'from-pdf', name: 'PDF to GIF', icon: 'pdf-to-gif',
  iconSvg: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M10 10H8v4h2v-1.5M13 10v4M16.5 10H15v4M15 12h1.5"/>',
  short: 'Save each page as a GIF picture.',
  title: 'PDF to GIF converter free, no upload | Survey',
  desc: 'Save PDF pages as GIF pictures, one per page, or all pages in one moving GIF. Free, in your browser, no upload.',
  h1: 'PDF to GIF',
  lede: 'Save each page of a PDF as a GIF picture, or put every page in one moving GIF that plays through them.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make GIFs',
  steps: ['Choose a PDF.', 'Pick the quality and which pages. Turn on "One moving GIF" to get a single file that shows each page in turn.', 'Press Make GIFs. More than one page comes as a ZIP.'],
  trade: {
    h2: 'Plan pages for chats and old systems',
    text: 'Some chat apps, intranets and older systems only take GIF. Save the sheets you need as GIF, or make one moving GIF that flips through a few sheets. For the sharpest still pictures, <a href="/tools/pdf-to-png">PDF to PNG</a> keeps more colors.',
    keys: 'plan sheet drawing set chat intranet animation',
  },
  faq: [
    ['Do I get one GIF or one per page?', 'One GIF for each page, in a ZIP when there is more than one. Turn on "One moving GIF of all the pages" to get one file that shows each page in turn.'],
    ['Why do photos look a little rough?', 'A GIF can only hold 256 colors, so photos lose some shading. Drawings and text look clean. For photos, PDF to JPG or PDF to PNG look better.'],
    ['Which quality should I pick?', 'Normal suits most screens. Pick High to zoom in on fine detail. Small makes the smallest files.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
