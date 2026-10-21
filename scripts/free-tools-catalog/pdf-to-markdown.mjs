import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-markdown', batch: true, group: 'from-pdf', name: 'PDF to Markdown', icon: 'pdf-to-markdown',
  iconSvg: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M9.5 17v-4.5l2 2.5 2-2.5V17"/><path d="M16.5 12.5V17M15 15.5l1.5 1.5 1.5-1.5"/>',
  short: 'Turn a PDF into Markdown for AI tools and notes.',
  title: 'PDF to Markdown converter free, no upload | Survey',
  desc: 'Turn a PDF into a Markdown (.md) file with headings, lists and page breaks, ready to paste into AI tools. Free, in your browser, no upload.',
  h1: 'PDF to Markdown',
  lede: 'Get the text of a PDF as Markdown, with headings and lists marked, ready to paste into an AI chat or your notes. Best for documents that are mostly text. Layout, tables and drawings are not kept. Scanned pages need <a href="/tools/ocr-pdf">OCR PDF</a> first.',
  accept: 'pdf', multiple: false, action: 'Make Markdown',
  steps: ['Choose a PDF.', 'Press Make Markdown.', 'Save the .md file, or open it and paste the text where you need it.'],
  trade: {
    h2: 'Specs into AI tools',
    text: 'Paste a spec section or an RFI log into an AI chat to find a requirement, list the submittals or draft a reply. Markdown keeps the headings and lists, so the AI can tell sections apart. Scanned pages need <a href="/tools/ocr-pdf">OCR PDF</a> first.',
    keys: 'spec specs specifications rfi submittals ai chatgpt claude llm',
  },
  faq: [
    ['What is Markdown?', 'Plain text with a few marks for structure: # for a heading, - for a list item and ** for bold. AI tools, wikis and note apps all read it.'],
    ['How are headings found?', 'Text set bigger than the body text becomes a heading, biggest first. Lines that start with a bullet or a number become lists.'],
    ['What does it not keep?', 'Layout, columns, tables, pictures and drawings. Each page starts with a page note, with a line between pages. Scanned pages have no text, so run OCR PDF first.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
