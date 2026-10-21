import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-viewer', group: 'fix', name: 'View PDF', icon: 'pdf-viewer',
  iconSvg: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  short: 'Open and read a PDF in your browser.',
  title: 'View PDF online free, no upload | Survey',
  desc: 'Open a PDF or a big drawing set in your browser. Scroll, zoom and see every page, then open it in Survey to mark it up. Free, no sign-up, no upload.',
  h1: 'View a PDF online',
  lede: 'Open a PDF right here to scroll through it and zoom in. When you want to mark it up, open it in Survey with one tap.',
  accept: 'pdf', multiple: false, action: 'Open in Survey',
  steps: ['Choose a PDF, or drop it on the page.', 'Scroll through the pages. Use + and - or Fit width to zoom.', 'Press Open in Survey to add notes, shapes and markups.'],
  trade: {
    h2: 'Look over a drawing set on any device',
    text: 'Open a full drawing set or a shop drawing on a phone, tablet or site laptop without installing anything. Zoom in on a detail, then open the set in Survey to mark it up with clouds, counts and notes.',
    keys: 'drawing set plan sheets shop drawings open read reader',
  },
  faq: [
    ['Can it open big drawing sets?', 'Yes. Only the pages you are looking at are drawn, so a set of large sheets scrolls smoothly. Very big files depend on how much memory your device has.'],
    ['How do I zoom?', 'Use the + and - buttons, Fit width or Actual size. On a computer you can also hold Ctrl (or Cmd) and scroll, or pinch on a trackpad.'],
    ['Can I add notes or markups?', 'Press Open in Survey. The PDF opens in the Survey app on this site, where you can add pens, shapes, clouds, text and counts for free.'],
    PRIVATE, FREE, LIMIT,
  ],
};
