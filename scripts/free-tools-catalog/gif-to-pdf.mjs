import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'gif-to-pdf', group: 'to-pdf', name: 'GIF to PDF', icon: 'image',
  short: 'Turn GIF images into a PDF.',
  title: 'GIF to PDF converter free, no upload | Survey',
  desc: 'Turn GIF images into one PDF. Use the first frame of a moving GIF, or put every frame on its own page. Free, in your browser, no upload.',
  h1: 'Convert GIF to PDF',
  lede: 'Turn GIF images into one PDF, one image per page. For a moving GIF, keep the first frame or every frame.',
  accept: 'image', multiple: true, action: 'Make PDF',
  steps: ['Choose your GIF images.', 'Pick First frame or Every frame, then set the order, page size and margins.', 'Press Make PDF and save it.'],
  trade: {
    h2: 'Step-by-step GIFs as printable pages',
    text: 'A moving GIF from a how-to or a product page can\'t be printed. Put every frame on its own page to hand out or file with a work procedure.',
    keys: 'animated moving frames how-to procedure printable',
  },
  faq: [
    ['What happens to a moving GIF?', 'By default you get its first frame. Pick Every frame to get each frame on its own page, in order.'],
    ['Is any quality lost?', 'No. The pictures are stored without loss, so colors and edges stay as they are in the GIF.'],
    ['Can I add other images too?', 'Yes. JPG, PNG, WebP, BMP and TIFF work too, and you can mix them.'],
    PRIVATE, FREE, LIMIT,
  ],
};
