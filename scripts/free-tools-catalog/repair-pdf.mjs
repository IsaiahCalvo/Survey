import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'repair-pdf', group: 'edit', name: 'Repair PDF', icon: 'repair',
  // A wrench over a page.
  iconSvg: '<path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h4"/><path d="M14 3l4.5 4.5V10"/><path d="M20.5 14.5a3 3 0 0 1-4 2.8L13.5 20.3a1.1 1.1 0 0 1-1.6-1.6l3-3a3 3 0 0 1 3.6-4l-1.8 1.8.4 1.4 1.4.4z"/>',
  short: 'Fix a PDF that won\'t open or shows errors.',
  title: 'Repair a damaged PDF free, no upload | Survey',
  desc: 'Fix a broken or damaged PDF in your browser: rebuilds a bad index, cuts stray data and saves the pages it can read. Free, no upload.',
  h1: 'Repair a damaged PDF',
  lede: 'Fix a PDF that won\'t open, shows errors or has blank pages. The tool rebuilds the file and keeps every page it can read.',
  accept: 'pdf', multiple: false, batch: true, action: 'Repair PDF',
  steps: ['Choose the damaged PDF.', 'Leave "Fix the file" on. Pick "Rebuild from pictures" only if that doesn\'t work.', 'Press Repair PDF and save the fixed copy.'],
  faq: [
    ['What kind of damage can it fix?', 'Files cut short by a failed download, files with a broken index, and files with stray data at the start. It saves every page it can still read and tells you how many that was.'],
    ['What does "Rebuild from pictures" do?', 'It draws each page as a picture and puts those pictures in a new PDF. It looks the same, but you can\'t select or search the text. Use it when the normal fix still won\'t open.'],
    ['Can it bring back pages that are missing?', 'No. If part of the file was never saved or downloaded, that part is gone. The tool keeps everything that is left.'],
    PRIVATE, FREE, LIMIT,
  ],
};
