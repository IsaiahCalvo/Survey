import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'bmp-to-pdf', group: 'to-pdf', name: 'BMP to PDF', icon: 'image',
  short: 'Turn BMP images into a PDF.',
  title: 'BMP to PDF converter free, no upload | Survey',
  desc: 'Turn BMP bitmap images into one PDF, one image per page, with no loss in quality. Free, in your browser, no upload.',
  h1: 'Convert BMP to PDF',
  lede: 'Turn BMP images into one PDF, one image per page. BMP files are big, so the PDF is often much smaller.',
  accept: 'image', multiple: true, action: 'Make PDF',
  steps: ['Choose your BMP images.', 'Set the order, page size and margins.', 'Press Make PDF and save it.'],
  trade: {
    h2: 'Old scans and exports to PDF',
    text: 'Older scanners, survey instruments and CAD exports sometimes save BMP files. Put them in one PDF that is easy to send, file and mark up.',
    keys: 'bitmap scan cad export instrument screenshot',
  },
  faq: [
    ['Is any quality lost?', 'No. The pictures are stored without loss, so every pixel is the same as in the BMP.'],
    ['Can I add other images too?', 'Yes. JPG, PNG, WebP, GIF and TIFF work too, and you can mix them.'],
    PRIVATE, FREE, LIMIT,
  ],
};
