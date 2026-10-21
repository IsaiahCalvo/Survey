import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-page-sizes', group: 'fix', name: 'PDF page sizes', icon: 'pdf-page-sizes',
  // A sheet with a ruler along two sides.
  iconSvg: '<rect x="7" y="7" width="14" height="14" rx="1.5"/><path d="M3 7v14M3 9h2M3 13h2M3 17h2M7 3h14M9 3v2M13 3v2M17 3v2"/>',
  short: 'See every page\'s size and the facts about a PDF.',
  title: 'Check PDF page sizes and info free | Survey',
  desc: 'See the size of every page in a PDF, in inches and mm, named like ARCH D, Tabloid or A1. Plus the PDF\'s details. Free, no upload.',
  h1: 'Check PDF page sizes',
  lede: 'See every page\'s size, named where it has a name, like Letter, ARCH D or A1. Also see who made the PDF, its version, and pages with no text.',
  accept: 'pdf', multiple: false, action: 'Check sizes',
  steps: ['Choose a PDF.', 'Read the sizes. Any page that is not the main size shows in red.', 'Press Download as CSV to keep the list.'],
  trade: {
    h2: 'Check a drawing set before it goes to the plotter',
    text: 'One letter page or an A1 sheet in an ARCH D set can stop a plot run or come out at the wrong scale. Check every sheet\'s size first, and see which pages are scans.',
    keys: 'plotter plot arch d 24x36 30x42 ansi d 22x34 11x17 sheet size drawing set scale',
  },
  faq: [
    ['Which sizes does it name?', 'Letter, Legal, Tabloid (11x17), ARCH A to E1, ANSI A to E and A0 to A5. A page within about 2.5 mm of a size gets its name. Others say Custom size.'],
    ['Does it look at turned pages?', 'Yes. Sizes are as the page shows on screen, so a turned page says landscape.'],
    ['What does "Pages with no text" mean?', 'Those pages have no text a computer can read. They are often scans. Use OCR PDF to make them searchable.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
