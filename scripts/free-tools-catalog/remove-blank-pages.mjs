import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'remove-blank-pages', group: 'pages', name: 'Remove blank pages', icon: 'remove-blank-pages',
  iconSvg: '<rect x="3" y="3" width="10" height="14" rx="1.5"/><path d="M6 7h4M6 10h4M6 13h2"/><rect x="11" y="7" width="10" height="14" rx="1.5" stroke-dasharray="2 2"/><path d="M14 12l4 4M18 12l-4 4"/>',
  short: 'Find empty pages and take them out.',
  title: 'Remove blank pages from a PDF free | Survey',
  desc: 'Find the empty pages in a PDF, like the backs of scans, and take them out. You check the pick first. Free, in your browser, no upload.',
  h1: 'Remove blank pages from a PDF',
  lede: 'Blank pages are found and picked for you. Check them, change the pick if you like, and save the PDF without them.',
  accept: 'pdf', multiple: false, action: 'Remove pages',
  steps: ['Choose a PDF. Each page is checked for marks.', 'Look over the picked pages. Tap a page to pick or unpick it, or change what counts as blank.', 'Press Remove pages and save the new file.'],
  trade: {
    h2: 'Drop the blank backs of scanned field reports',
    text: 'Scanning daily reports or forms on both sides leaves blank backs. Remove them in one pass, and check the pick before you save.',
    keys: 'scanned field reports daily reports double sided duplex scan',
  },
  faq: [
    ['How does it know a page is blank?', 'It looks at every page and counts the marks on it. A page with no marks, or almost none, is picked.'],
    ['What do the blank settings mean?', '"Only empty" picks pages with nothing at all. "Normal" also picks pages with a stray dot or just a page number. "Nearly empty too" also picks scanned backs with specks and shadows.'],
    ['Can I keep a page it picked?', 'Yes. Tap it to unpick it before you save. Nothing is removed until you press Remove pages.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
