import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'reverse-pdf', group: 'pages', name: 'Reverse PDF', icon: 'reverse',
  iconSvg: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  short: 'Flip the page order so the last page comes first.',
  title: 'Reverse PDF page order free | Survey',
  desc: 'Flip the order of the pages in a PDF so the last page is first. Handy for scans fed in backwards. Free, no upload.',
  h1: 'Reverse PDF page order',
  lede: 'Turn the page order around in one step, so the last page comes first.',
  accept: 'pdf', multiple: false, batch: true, action: 'Reverse pages',
  steps: ['Choose a PDF.', 'Check the pages.', 'Press Reverse pages and save the new file.'],
  trade: {
    h2: 'Fix sheets scanned in backwards',
    text: 'If a stack of field reports or sheets went through the scanner last page first, flip the order in one step instead of moving each page.',
    keys: 'scanned backwards field reports sheets',
  },
  faq: [
    ['When would I need this?', 'When a scanner or printer put the pages in backwards, like a stack fed in from the last page.'],
    ['Is anything else changed?', 'No. Each page keeps its text, markups, links and form fields. Only the order changes.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
