import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'resize-pdf', group: 'layout', name: 'Resize PDF pages', icon: 'resize',
  iconSvg: '<rect x="3" y="7" width="10" height="14" rx="1"/><path d="M9 3h12v12M15 3h6v6M21 3l-7 7"/>',
  short: 'Change the page size to Letter, A4, A3 or ARCH D.',
  title: 'Resize PDF pages to Letter, A4 or A3 free | Survey',
  desc: 'Change PDF page size to Letter, A4, A3, Legal, Tabloid or ARCH D. Pages are scaled to fit and stay sharp. Free, no upload.',
  h1: 'Resize PDF pages',
  lede: 'Fit every page onto Letter, A4, A3, Legal, Tabloid or ARCH D paper. Lines and text stay sharp.',
  accept: 'pdf', multiple: false, batch: true, action: 'Resize PDF',
  steps: ['Choose a PDF.', 'Pick the new page size, and a margin if you want one.', 'Press Resize PDF and save the new file.'],
  faq: [
    ['Will the pages be stretched?', 'No. Each page is scaled up or down to fit the new size and keeps its shape. Any space left over stays white.'],
    ['Does it stay sharp?', 'Yes. Lines and text are moved over as they are, not turned into a picture, so you can zoom in and print at full quality.'],
    ['What happens to markups, links and form fields?', 'With "Keep markups" on, markups and filled-in forms are drawn onto the page so they still show, but you can no longer edit them. Links stop working either way. To keep them, use Survey to mark up the resized file instead.'],
    ['What is ARCH D?', 'A 24 by 36 inch sheet that is common for building drawings in the US.'],
    ['Are sideways pages handled?', 'Yes. With "Match each page" on, a wide page goes on a wide sheet and a tall page on a tall sheet.'],
    PRIVATE, FREE, LIMIT,
  ],
};
