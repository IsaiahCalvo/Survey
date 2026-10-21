import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'split-by-bookmarks', group: 'pages', name: 'Split by bookmarks', icon: 'bookmark',
  // A bookmark ribbon with a cut line.
  iconSvg: '<path d="M7 3h10v18l-5-4-5 4z"/><path d="M3 11h4M17 11h4"/>',
  short: 'One PDF per chapter or sheet, from its bookmarks.',
  title: 'Split PDF by bookmarks free, no upload | Survey',
  desc: 'Split a PDF into one file per bookmark, named after each one. Pick top-level or second-level bookmarks. Free, in your browser, no upload.',
  h1: 'Split a PDF by bookmarks',
  lede: 'Turn a long PDF into one file per chapter, section or sheet, using the bookmarks already in it. Each file is named after its bookmark.',
  accept: 'pdf', multiple: false, action: 'Split PDF',
  steps: ['Choose a PDF that has bookmarks.', 'Check the bookmarks found, and pick top level or top and second level.', 'Press Split PDF. The files come in one ZIP.'],
  faq: [
    ['What are bookmarks in a PDF?', 'They are the list of chapters or sheets shown in the side panel of most PDF readers. Many drawing sets and reports have them.'],
    ['What if my PDF has no bookmarks?', 'The tool tells you as soon as you choose the file. Use Split PDF instead to split it by page numbers.'],
    ['What happens to pages before the first bookmark?', 'They go into their own file, named "Before the first bookmark", so no page is lost.'],
    ['Why do the file names start with numbers?', 'So the files stay in the same order as the bookmarks when you open the ZIP.'],
    PRIVATE, FREE, LIMIT,
  ],
};
