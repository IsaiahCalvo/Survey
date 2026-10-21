import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'rtf-to-pdf', batch: true, group: 'to-pdf', name: 'RTF to PDF', icon: 'rtf-to-pdf',
  iconSvg: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 12h6M10 15h6M10 18h4"/>',
  short: 'Turn an .rtf document into a PDF.',
  title: 'RTF to PDF converter free, no upload | Survey',
  desc: 'Convert RTF documents to PDF in your browser. Keeps bold and italic text, headings, lists, tables, links and pictures. Free, no upload.',
  h1: 'Convert RTF to PDF',
  lede: 'Turn a Rich Text (.rtf) document into a PDF without uploading it. Best for letters, notes and simple reports.',
  accept: 'rtf', multiple: false, action: 'Make PDF',
  steps: ['Choose an RTF file (.rtf).', 'Pick the page size and font.', 'Press Make PDF and save it.'],
  trade: {
    h2: 'Old specs and letters to PDF',
    text: 'Older spec sections, transmittals and letters saved from WordPad or older Word versions often come as .rtf. Turn them into PDFs to send or file with the job.',
    keys: 'spec section transmittal letter wordpad rich text',
  },
  faq: [
    ['Will it look exactly like the original?', 'Close for simple documents: headings, bold, italic and underlined text, lists, tables, links and PNG or JPEG pictures carry over. Fonts, colors, columns, text boxes and headers or footers don\'t, and the tool tells you when a file has some of those.'],
    ['Can I select the text in the PDF?', 'Yes. The text stays real text, so you can search it and copy it.'],
    ['What is an RTF file?', 'Rich Text Format, an older document type that WordPad, TextEdit and Word can all save. It holds text with simple styling.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
