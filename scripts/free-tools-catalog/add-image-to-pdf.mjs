import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'add-image-to-pdf', group: 'edit', name: 'Add image to PDF', icon: 'add-image-to-pdf',
  // A page with a small picture in its corner.
  iconSvg: '<rect x="4" y="2" width="16" height="20" rx="1.5"/><path d="M7 6h7M7 9h5"/><rect x="11" y="13" width="7" height="6" rx="1"/><path d="M11 18l2.5-2.5L16 18"/>',
  short: 'Put a logo, stamp or signature on PDF pages.',
  title: 'Add an image or logo to a PDF free | Survey',
  desc: 'Put a PNG or JPG, like a logo, stamp or signature, on every page or the pages you pick. Set where, how big and how see-through. Free, no upload.',
  h1: 'Add an image to a PDF',
  lede: 'Place a logo, stamp, signature or north arrow on the pages you pick. Choose the corner, the size and how see-through it is.',
  accept: 'pdf', multiple: false, action: 'Add image',
  steps: ['Choose a PDF.', 'Choose a PNG or JPG, then pick where it goes, its size and the pages.', 'Press Add image and save the file.'],
  trade: {
    h2: 'Stamp your logo or a north arrow on every sheet',
    text: 'Add your company logo to a drawing set, a reviewed stamp to shop drawings, or a north arrow to site plans. Pick a corner and a size, and it lands in the same spot on every page.',
    keys: 'logo company stamp reviewed stamp approved north arrow seal shop drawings site plan title block',
  },
  faq: [
    ['Which images work?', 'PNG and JPG. Use a PNG with a see-through background for logos and stamps, so the page shows around them.'],
    ['How is the size set?', 'As a share of the page width. 20% on a letter page is about 1.7 inches wide. The height follows the image\'s shape.'],
    ['Can I put it on some pages only?', 'Yes. Pick All, First, or Some and type the pages, like 1-3, 8.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
