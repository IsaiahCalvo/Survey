import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'split-by-size', group: 'pages', name: 'Split PDF by size', icon: 'split-by-size',
  // A tall sheet cut into two shorter ones, with a size bar beside them.
  iconSvg: '<rect x="4" y="2" width="11" height="9" rx="1.5"/><rect x="4" y="13" width="11" height="9" rx="1.5"/><path d="M19 3v18M17 5l2-2 2 2M17 19l2 2 2-2"/>',
  short: 'Split a big PDF into parts under a size, like 10 MB.',
  title: 'Split a PDF by file size free, no upload | Survey',
  desc: 'Split a big PDF into parts that each stay under 10, 20 or 25 MB, or a size you pick. Free, in your browser, no upload.',
  h1: 'Split a PDF by file size',
  lede: 'Too big to email or upload? Split the PDF into parts that each stay under the size you pick. Pages stay in order.',
  accept: 'pdf', multiple: false, action: 'Split PDF',
  steps: ['Choose a PDF.', 'Pick the most each part can be: 10, 20 or 25 MB, or type your own.', 'Press Split PDF. The parts come in one ZIP.'],
  trade: {
    h2: 'Fit a drawing set under email and portal limits',
    text: 'Email often stops at 20 or 25 MB, and many bid and permit portals cap each upload at 10 MB. Split the set into parts that fit, named "part 1 of 3" and so on, so the other side can put them back in order.',
    keys: 'email attachment limit upload portal bid permit submittal drawing set too big',
  },
  faq: [
    ['How does it decide where to split?', 'It adds pages to a part one at a time and starts a new part when the next page would push it over your size. Then it checks each part\'s real size.'],
    ['What if one page is bigger than the limit?', 'That page gets a part of its own, and the tool tells you which page it is. Try Compress PDF on that part to make it smaller.'],
    ['Are the pages changed?', 'No. Each page is copied as it is, at the same quality. Only the file is cut into parts.'],
    PRIVATE, FREE, LIMIT,
  ],
};
