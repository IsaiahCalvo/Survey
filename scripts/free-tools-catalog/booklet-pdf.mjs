import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'booklet-pdf', group: 'layout', name: 'Make a booklet', icon: 'booklet',
  iconSvg: '<path d="M12 6c-2-1.5-5-2-9-2v14c4 0 7 .5 9 2 2-1.5 5-2 9-2V4c-4 0-7 .5-9 2z"/><path d="M12 6v14"/>',
  short: 'Print a PDF as a folded, stapled booklet.',
  title: 'Make a booklet from a PDF free | Survey',
  desc: 'Turn a PDF into a booklet you print on both sides, fold and staple. Pages are put in the right order for you. Free, no upload.',
  h1: 'Make a booklet from a PDF',
  lede: 'Put the pages in booklet order, two to a side, so you can print, fold in half and staple.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make booklet',
  steps: ['Choose a PDF.', 'Pick the paper you will print on.', 'Press Make booklet, then print on both sides, flipping on the short edge. Fold the stack and staple the fold.'],
  trade: {
    h2: 'Print a spec section or safety plan as a booklet',
    text: 'Fold a spec section, a site safety plan or an equipment manual into a booklet that is easy to carry on site.',
    keys: 'spec section safety plan manual',
  },
  faq: [
    ['How do I print it?', 'Print on both sides of the paper and choose "flip on short edge". Keep the sheets in order, fold the whole stack in half and staple along the fold.'],
    ['Why were blank pages added?', 'Each folded sheet holds 4 pages, so a booklet needs a multiple of 4. Blank pages are added at the end to make it fit.'],
    ['What paper size should I pick?', 'Letter or A4 makes a booklet half that size. Tabloid makes Letter-size pages and A3 makes A4-size pages. "Two pages wide" keeps your pages at full size.'],
    ['How many pages can a booklet have?', 'Any number, but past about 64 pages the stack is hard to fold. Split long files into parts first.'],
    PRIVATE, FREE, LIMIT,
  ],
};
