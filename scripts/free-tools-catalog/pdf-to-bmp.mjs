import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-bmp', group: 'from-pdf', name: 'PDF to BMP', icon: 'pdf-to-bmp',
  iconSvg: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h3v3H8zM13 8h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z"/>',
  short: 'Save each page as a BMP picture.',
  title: 'PDF to BMP converter free, no upload | Survey',
  desc: 'Save PDF pages as BMP pictures for older programs that need them. Pick the quality and the pages. Free, in your browser, no upload.',
  h1: 'PDF to BMP',
  lede: 'Save each page of a PDF as a BMP picture, for older programs that only open BMP.',
  accept: 'pdf', multiple: false, action: 'Make images',
  steps: ['Choose a PDF.', 'Pick the quality and which pages.', 'Press Make images. More than one page comes as a ZIP.'],
  trade: {
    h2: 'Sheets for older programs',
    text: 'If an older program on site only opens BMP, save the sheets or details you need as BMP. If it opens PNG, use <a href="/tools/pdf-to-png">PDF to PNG</a> for smaller files.',
    keys: 'plan sheet detail older software',
  },
  faq: [
    ['Why are BMP files so big?', 'BMP keeps every pixel with no squeezing at all. If the program you use can open PNG, PDF to PNG gives the same sharp picture in a much smaller file.'],
    ['Which quality should I pick?', 'Normal suits most screens. Pick High for printing. Small makes the smallest files.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
