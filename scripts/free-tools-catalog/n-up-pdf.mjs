import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'n-up-pdf', group: 'layout', name: 'Pages per sheet', icon: 'nup',
  iconSvg: '<rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M12 3v18M3 12h18"/>',
  short: 'Put 2, 4, 6 or 9 pages on one sheet.',
  title: 'Put several PDF pages on one sheet free | Survey',
  desc: 'Print 2, 4, 6 or 9 PDF pages on one sheet to save paper. Letter, A4 or the same size. Free, in your browser, no upload.',
  h1: 'Put several pages on one sheet',
  lede: 'Shrink 2, 4, 6 or 9 pages onto each sheet to save paper or make a handout.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make PDF',
  steps: ['Choose a PDF.', 'Pick how many pages go on each sheet, and the sheet size.', 'Press Make PDF and save or print the new file.'],
  trade: {
    h2: 'Print several details on one sheet',
    text: 'Put 2 or 4 detail or spec pages on one sheet to carry in the truck or pin up in the site office. Text stays sharp, so you can still zoom in on screen.',
    keys: 'details spec pages print handout',
  },
  faq: [
    ['What order do the pages go in?', 'Across, then down, the way you read: page 1 top left, page 2 to its right, and so on.'],
    ['Will small text still be readable?', 'Lines and text are kept sharp, not turned into a picture, so you can zoom in. On paper, 2 or 4 per sheet is easiest to read.'],
    ['Can I add a line around each page?', 'Yes. Turn on "Thin line around each page".'],
    ['What happens to markups and links?', 'With "Keep markups" on, markups and filled-in forms are drawn onto the page so they show, but can no longer be edited. Links stop working.'],
    PRIVATE, FREE, LIMIT,
  ],
};
