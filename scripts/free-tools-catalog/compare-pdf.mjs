import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'compare-pdf',
  group: 'fix',
  name: 'Compare PDFs',
  icon: 'compare',
  iconSvg: '<rect x="3" y="4" width="7.5" height="16" rx="1"/><rect x="13.5" y="4" width="7.5" height="16" rx="1"/><path d="M5.5 8.5h2.5M5.5 12h2.5M16 8.5h2.5M16 12h2.5M16 15.5h2.5"/>',
  short: 'See what changed between two versions of a PDF.',
  title: 'Compare two PDFs and see changes free | Survey',
  desc: 'Find what changed between two PDFs or drawing revisions: removed words in red, added in green, changed areas boxed. Free, with no upload.',
  h1: 'Compare two PDFs',
  lede: 'Add the old version and the new one. You get a report with each changed page side by side, and the changed words marked.',
  accept: 'pdf',
  multiple: true,
  action: 'Compare PDFs',
  steps: [
    'Choose two PDFs: the old version first, then the new one.',
    'Pick whether the report shows only changed pages or all of them.',
    'Press Compare PDFs and save the report.',
  ],
  trade: {
    h2: 'Compare drawing revisions',
    text: 'Add the old sheet and the revised one. With "Also check how pages look" on, the report boxes the areas that changed, like a moved line or a new note, so you don\'t have to flip back and forth.',
    keys: 'drawing revisions revised sheets rev changes plan sheets',
  },
  faq: [
    ['What does the report show?', 'A first page lists the changes page by page, like "Page 3: 4 words removed, 6 added". Then each changed page is shown with the old version on the left and the new one on the right. Removed words are red and added words are green.'],
    ['Can it compare scanned PDFs?', 'Not word by word, since a scan is a picture with no text in it. Leave "Also check how pages look" on and pages that look different get an orange box around the changed area.'],
    ['Does it find changes in drawings?', 'Yes, when "Also check how pages look" is on. It compares how each pair of pages looks and boxes the areas that are different, such as a moved line or a new symbol.'],
    PRIVATE, FREE, LIMIT,
  ],
};
