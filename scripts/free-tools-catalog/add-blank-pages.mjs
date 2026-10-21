import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'add-blank-pages', group: 'pages', name: 'Insert blank pages', icon: 'blank',
  iconSvg: '<rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1" stroke-dasharray="2 2"/>',
  short: 'Add empty pages after every page or where you choose.',
  title: 'Insert blank pages into a PDF free | Survey',
  desc: 'Add blank pages to a PDF after every page, after chosen pages, or at the start or end. Free, in your browser, no upload.',
  h1: 'Insert blank pages into a PDF',
  lede: 'Add empty pages for notes, or so each page prints on its own sheet when printing on both sides.',
  accept: 'pdf', multiple: false, action: 'Add pages',
  steps: ['Choose a PDF.', 'Pick where the blank pages go and how many.', 'Press Add pages and save the new file.'],
  faq: [
    ['What size are the blank pages?', 'The same size and way round as the page just before them, so they print the same.'],
    ['Why add a blank page after every page?', 'So each page lands on its own sheet when you print on both sides, or to leave room for hand-written notes.'],
    ['Is anything else changed?', 'No. Your pages keep their text, markups, links and form fields.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
